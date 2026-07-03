import os
import threading
import time
from datetime import datetime, timedelta

from .backup_validation import (
    format_local_datetime,
    parse_backup_schedule_time,
    safe_backup_filename,
)


class BackupSchedulerMixin:
    def scheduled_backup_time_parts(self):
        return parse_backup_schedule_time(self.schedule_time)

    def scheduled_backup_is_enabled(self):
        return self.schedule_enabled and self.scheduled_backup_time_parts() is not None

    def calculate_next_scheduled_backup_time(self, now=None):
        parts = self.scheduled_backup_time_parts()
        if not parts:
            return None

        now = now or datetime.now()
        hour, minute = parts
        next_run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if next_run <= now:
            next_run += timedelta(days=1)
        return next_run

    def update_scheduled_backup_state(self, **updates):
        with self.state_lock:
            self.state.update(updates)

    def get_scheduled_backup_status(self):
        valid_schedule = self.scheduled_backup_time_parts() is not None
        with self.state_lock:
            state = dict(self.state)

        next_run_at = state.get('next_run_at', '')
        if self.schedule_enabled and valid_schedule and not next_run_at:
            next_run_at = format_local_datetime(self.calculate_next_scheduled_backup_time())

        state['next_run_at'] = next_run_at
        state.update({
            'configured': self.schedule_enabled,
            'enabled': self.schedule_enabled and valid_schedule,
            'valid_schedule': valid_schedule,
            'schedule_time': self.schedule_time,
            'retention_count': self.retention_count
        })
        return state

    def list_scheduled_backup_files(self):
        os.makedirs(self.backup_dir, exist_ok=True)
        scheduled_backups = []
        for entry in os.scandir(self.backup_dir):
            if not entry.is_file():
                continue
            filename = safe_backup_filename(entry.name)
            if not filename:
                continue
            if not filename.startswith(self.scheduled_prefix) or not filename.endswith('.full.tar.gz'):
                continue
            stat = entry.stat()
            scheduled_backups.append({
                'filename': filename,
                'path': entry.path,
                'mtime': stat.st_mtime
            })
        scheduled_backups.sort(key=lambda item: item['mtime'], reverse=True)
        return scheduled_backups

    def cleanup_scheduled_backups(self):
        if self.retention_count <= 0:
            return []

        scheduled_backups = self.list_scheduled_backup_files()
        expired_backups = scheduled_backups[self.retention_count:]
        deleted = []
        for backup in expired_backups:
            try:
                deleted.append(self.delete_database_backup_file(backup['filename']))
            except FileNotFoundError:
                continue
        return deleted

    def run_scheduled_backup_once(self):
        run_at = format_local_datetime(datetime.now())
        if not self.maintenance_lock.acquire(blocking=False):
            message = '已有数据库维护任务正在执行，已跳过本次定时备份'
            self.logger.warning("Scheduled backup skipped: maintenance lock is busy")
            self.update_scheduled_backup_state(
                last_run_at=run_at,
                last_result='skipped',
                last_message=message
            )
            return

        try:
            backup = self.run_database_backup(prefix=self.scheduled_prefix)
            deleted = self.cleanup_scheduled_backups()
            message = f"已创建定时备份：{backup['filename']}"
            if deleted:
                message = f"{message}；已清理 {len(deleted)} 个过期定时备份"
            self.logger.info("Scheduled backup created: %s; removed %s expired backup(s)", backup['filename'], len(deleted))
            self.update_scheduled_backup_state(
                last_run_at=run_at,
                last_result='success',
                last_message=message
            )
        except Exception as e:
            self.logger.exception("Scheduled backup failed")
            self.update_scheduled_backup_state(
                last_run_at=run_at,
                last_result='failed',
                last_message=str(e) or '定时备份失败'
            )
        finally:
            self.maintenance_lock.release()

    def scheduled_backup_worker(self):
        while self.scheduled_backup_is_enabled():
            next_run = self.calculate_next_scheduled_backup_time()
            if not next_run:
                self.update_scheduled_backup_state(
                    next_run_at='',
                    last_result='disabled',
                    last_message='定时备份时间配置无效'
                )
                return

            self.update_scheduled_backup_state(next_run_at=format_local_datetime(next_run))
            while True:
                remaining_seconds = (next_run - datetime.now()).total_seconds()
                if remaining_seconds <= 0:
                    break
                time.sleep(min(remaining_seconds, 60))

            self.run_scheduled_backup_once()

        self.update_scheduled_backup_state(next_run_at='')

    def start_scheduled_backup_thread(self, debug_enabled=False):
        if not self.schedule_enabled:
            self.update_scheduled_backup_state(
                next_run_at='',
                last_result='disabled',
                last_message='定时备份未启用'
            )
            return

        if self.scheduled_backup_time_parts() is None:
            self.logger.warning("DB_BACKUP_SCHEDULE_TIME is invalid: %s", self.schedule_time)
            self.update_scheduled_backup_state(
                next_run_at='',
                last_result='disabled',
                last_message='定时备份时间配置无效，请使用 HH:MM'
            )
            return

        if debug_enabled and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
            return

        with self.thread_lock:
            if self.thread_started:
                return
            self.thread_started = True

        thread = threading.Thread(
            target=self.scheduled_backup_worker,
            name='scheduled-backup',
            daemon=True
        )
        thread.start()
        self.logger.info(
            "Scheduled backup enabled at %s, retention count=%s",
            self.schedule_time,
            self.retention_count
        )
