import gzip
import io
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import threading
import time
from datetime import datetime, timedelta

from .paths import is_path_inside


SCHEDULED_BACKUP_PREFIX = 'scheduled_'
BACKUP_FILENAME_PATTERN = re.compile(r'^[A-Za-z0-9_.-]+(?:\.full\.tar\.gz|\.sql(?:\.gz)?)$')


class DatabaseUpgradeRequiredError(RuntimeError):
    pass


def safe_backup_filename(filename):
    filename = (filename or '').strip()
    if not filename:
        return None
    if '/' in filename or '\\' in filename or filename in {'.', '..'}:
        return None
    if not BACKUP_FILENAME_PATTERN.fullmatch(filename):
        return None
    return filename


def read_process_error(error_path):
    try:
        with open(error_path, 'rb') as f:
            return f.read(4096).decode('utf-8', errors='replace').strip()
    except OSError:
        return ''


def is_database_upgrade_error(error_text):
    normalized = (error_text or '').lower()
    return (
        'mysql.proc' in normalized
        or 'mariadb-upgrade' in normalized
        or ('column count' in normalized and 'is wrong' in normalized)
    )


def database_upgrade_message():
    return (
        'MariaDB 系统表需要升级。当前数据库可能从旧版本升级而来，'
        '请在服务器执行 mariadb-upgrade 后重启 db/web；本项目默认备份已关闭 routines。'
    )


def database_upgrade_command_hint():
    return 'docker compose exec db sh -c \'mariadb-upgrade -uroot -p"$MYSQL_ROOT_PASSWORD"\''


def classify_backup_filename(filename, scheduled_prefix=SCHEDULED_BACKUP_PREFIX):
    safe_filename = safe_backup_filename(filename)
    if not safe_filename:
        return None
    if safe_filename.startswith(scheduled_prefix) and safe_filename.endswith('.full.tar.gz'):
        return {
            'type': 'scheduled_full',
            'type_label': '定时备份',
            'includes_images': True,
            'scheduled': True
        }
    if safe_filename.endswith('.full.tar.gz'):
        return {
            'type': 'full',
            'type_label': '完整备份',
            'includes_images': True,
            'scheduled': False
        }
    if safe_filename.endswith('.sql') or safe_filename.endswith('.sql.gz'):
        return {
            'type': 'database',
            'type_label': '仅数据库',
            'includes_images': False,
            'scheduled': False
        }
    return None


def add_bytes_to_tar(tar, arcname, data, mtime=None):
    payload = data if isinstance(data, bytes) else data.encode('utf-8')
    info = tarfile.TarInfo(arcname)
    info.size = len(payload)
    info.mtime = int(mtime or time.time())
    tar.addfile(info, io.BytesIO(payload))


def safe_tar_member_name(name):
    name = (name or '').replace('\\', '/').strip()
    if not name or name.startswith('/') or name.startswith('../'):
        return None
    parts = [part for part in name.split('/') if part]
    if not parts or any(part in {'.', '..'} for part in parts):
        return None
    return '/'.join(parts)


def validate_full_backup_member(member, image_filename_normalizer):
    if member.issym() or member.islnk() or member.isdev():
        return False
    if not (member.isfile() or member.isdir()):
        return False

    safe_name = safe_tar_member_name(member.name)
    if not safe_name:
        return False
    if safe_name in {'manifest.json', 'database.sql.gz', 'images'}:
        return True
    if safe_name.startswith('images/'):
        relative_path = safe_name[len('images/'):]
        if not relative_path:
            return member.isdir()
        if member.isdir():
            return len(relative_path.split('/')) == 1 and relative_path.isdigit() and len(relative_path) == 4
        return image_filename_normalizer(relative_path) == relative_path
    return False


def parse_backup_schedule_time(value):
    match = re.fullmatch(r'([01]\d|2[0-3]):([0-5]\d)', (value or '').strip())
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def format_local_datetime(value):
    if not value:
        return ''
    return value.strftime('%Y-%m-%d %H:%M:%S')


class BackupService:
    def __init__(
        self,
        *,
        db_config_getter,
        backup_dir_getter,
        upload_folder_getter,
        db_connection_factory,
        logger,
        image_filename_normalizer,
        include_routines_getter,
        schedule_enabled_getter,
        schedule_time_getter,
        retention_count_getter,
        scheduled_prefix=SCHEDULED_BACKUP_PREFIX
    ):
        self.db_config_getter = db_config_getter
        self.backup_dir_getter = backup_dir_getter
        self.upload_folder_getter = upload_folder_getter
        self.db_connection_factory = db_connection_factory
        self.logger = logger
        self.image_filename_normalizer = image_filename_normalizer
        self.include_routines_getter = include_routines_getter
        self.schedule_enabled_getter = schedule_enabled_getter
        self.schedule_time_getter = schedule_time_getter
        self.retention_count_getter = retention_count_getter
        self.scheduled_prefix = scheduled_prefix
        self.maintenance_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.thread_lock = threading.Lock()
        self.thread_started = False
        self.state = {
            'next_run_at': '',
            'last_run_at': '',
            'last_result': '',
            'last_message': ''
        }

    @property
    def db_config(self):
        return self.db_config_getter()

    @property
    def backup_dir(self):
        return self.backup_dir_getter()

    @property
    def upload_folder(self):
        return self.upload_folder_getter()

    @property
    def include_routines(self):
        return self.include_routines_getter()

    @property
    def schedule_enabled(self):
        return self.schedule_enabled_getter()

    @property
    def schedule_time(self):
        return self.schedule_time_getter()

    @property
    def retention_count(self):
        return self.retention_count_getter()

    def sanitized_database_name(self):
        value = re.sub(r'[^A-Za-z0-9_.-]+', '_', self.db_config['database']).strip('._-')
        return value or 'database'

    def get_backup_file_path(self, filename, must_exist=False):
        safe_filename = safe_backup_filename(filename)
        if not safe_filename:
            return None

        root_path = os.path.realpath(self.backup_dir)
        candidate_path = os.path.realpath(os.path.join(root_path, safe_filename))
        if not is_path_inside(root_path, candidate_path):
            return None
        if must_exist and not os.path.isfile(candidate_path):
            return None
        return candidate_path

    def backup_command_env(self):
        env = os.environ.copy()
        env['MYSQL_PWD'] = self.db_config['password']
        return env

    def get_database_upgrade_diagnostics(self):
        try:
            with self.db_connection_factory() as conn:
                cursor = conn.cursor()
                cursor.execute("SHOW FUNCTION STATUS WHERE Db = %s", (self.db_config['database'],))
                cursor.fetchall()
                cursor.execute("SHOW PROCEDURE STATUS WHERE Db = %s", (self.db_config['database'],))
                cursor.fetchall()
            return {
                'database_upgrade_required': False,
                'database_upgrade_message': '',
                'database_upgrade_command': ''
            }
        except Exception as e:
            error_text = str(e)
            if is_database_upgrade_error(error_text):
                self.logger.warning("MariaDB system table upgrade is required: %s", error_text)
                return {
                    'database_upgrade_required': True,
                    'database_upgrade_message': database_upgrade_message(),
                    'database_upgrade_command': database_upgrade_command_hint()
                }
            self.logger.warning("MariaDB upgrade diagnostic failed: %s", e)
            return {
                'database_upgrade_required': False,
                'database_upgrade_message': '',
                'database_upgrade_command': ''
            }

    def build_database_dump_command(self):
        cmd = [
            'mariadb-dump',
            '--single-transaction',
            '--triggers',
            '--default-character-set=utf8mb4',
            '-h', self.db_config['host'],
            '-u', self.db_config['user'],
            self.db_config['database']
        ]
        if self.include_routines:
            cmd.insert(2, '--routines')
        return cmd

    def classify_backup_filename(self, filename):
        return classify_backup_filename(filename, self.scheduled_prefix)

    def iter_safe_image_files(self):
        root_path = os.path.realpath(self.upload_folder)
        if not os.path.isdir(root_path):
            return []

        image_files = []
        for dirpath, dirnames, filenames in os.walk(root_path, followlinks=False):
            dirnames[:] = [
                dirname for dirname in dirnames
                if not os.path.islink(os.path.join(dirpath, dirname))
            ]
            for filename in filenames:
                abs_path = os.path.join(dirpath, filename)
                if os.path.islink(abs_path) or not os.path.isfile(abs_path):
                    continue
                if not is_path_inside(root_path, abs_path):
                    continue

                relative_path = os.path.relpath(abs_path, root_path).replace('\\', '/')
                safe_relative_path = self.image_filename_normalizer(relative_path)
                if safe_relative_path != relative_path:
                    self.logger.warning("Skipped unsafe image during backup: %s", relative_path)
                    continue
                image_files.append((abs_path, safe_relative_path))

        image_files.sort(key=lambda item: item[1].lower())
        return image_files

    def run_database_dump_to_file(self, target_path):
        temp_path = f'{target_path}.tmp'
        error_path = f'{target_path}.err'
        cmd = self.build_database_dump_command()

        try:
            with open(error_path, 'wb') as error_file:
                process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=error_file,
                    env=self.backup_command_env()
                )
                with gzip.open(temp_path, 'wb') as output:
                    while True:
                        chunk = process.stdout.read(1024 * 1024)
                        if not chunk:
                            break
                        output.write(chunk)
                return_code = process.wait()

            if return_code != 0:
                error_text = read_process_error(error_path)
                self.logger.error("Database backup failed with exit code %s: %s", return_code, error_text)
                if is_database_upgrade_error(error_text):
                    raise DatabaseUpgradeRequiredError(database_upgrade_message())
                raise RuntimeError('Database backup command failed')

            os.replace(temp_path, target_path)
        finally:
            for cleanup_path in (temp_path, error_path):
                try:
                    if os.path.exists(cleanup_path):
                        os.remove(cleanup_path)
                except OSError:
                    self.logger.warning("Unable to remove temporary backup file: %s", cleanup_path)

    def run_database_backup(self, prefix=''):
        os.makedirs(self.backup_dir, exist_ok=True)
        timestamp = time.strftime('%Y%m%d_%H%M%S')
        filename = f"{prefix}{self.sanitized_database_name()}_{timestamp}.full.tar.gz"
        target_path = self.get_backup_file_path(filename)
        if not target_path:
            raise ValueError('Invalid backup filename')

        temp_archive_path = f'{target_path}.tmp'
        with tempfile.TemporaryDirectory(prefix='backup_build_', dir=self.backup_dir) as temp_dir:
            dump_path = os.path.join(temp_dir, 'database.sql.gz')
            self.run_database_dump_to_file(dump_path)

            image_files = self.iter_safe_image_files()
            manifest = {
                'version': 1,
                'type': 'full',
                'database': self.db_config['database'],
                'created_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                'include_routines': self.include_routines,
                'database_dump': 'database.sql.gz',
                'images_root': 'images',
                'images_count': len(image_files)
            }

            try:
                with tarfile.open(temp_archive_path, 'w:gz') as tar:
                    tar.add(dump_path, arcname='database.sql.gz', recursive=False)
                    for abs_path, relative_path in image_files:
                        tar.add(abs_path, arcname=f'images/{relative_path}', recursive=False)
                    add_bytes_to_tar(
                        tar,
                        'manifest.json',
                        json.dumps(manifest, ensure_ascii=False, indent=2)
                    )
                os.replace(temp_archive_path, target_path)
            finally:
                try:
                    if os.path.exists(temp_archive_path):
                        os.remove(temp_archive_path)
                except OSError:
                    self.logger.warning("Unable to remove temporary full backup file: %s", temp_archive_path)

        return self.format_backup_file(filename, target_path)

    def run_database_restore_from_path(self, backup_path):
        if not backup_path or not os.path.isfile(backup_path):
            raise FileNotFoundError('Backup file not found')

        error_path = f'{backup_path}.restore.err'
        cmd = [
            'mariadb',
            '--default-character-set=utf8mb4',
            '-h', self.db_config['host'],
            '-u', self.db_config['user'],
            self.db_config['database']
        ]
        opener = gzip.open if backup_path.endswith('.gz') else open

        try:
            with opener(backup_path, 'rb') as input_file, open(error_path, 'wb') as error_file:
                process = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=error_file,
                    env=self.backup_command_env()
                )
                try:
                    while True:
                        chunk = input_file.read(1024 * 1024)
                        if not chunk:
                            break
                        process.stdin.write(chunk)
                    process.stdin.close()
                except OSError:
                    process.kill()
                    raise

                return_code = process.wait()

            if return_code != 0:
                error_text = read_process_error(error_path)
                self.logger.error("Database restore failed with exit code %s: %s", return_code, error_text)
                raise RuntimeError('Database restore command failed')
        finally:
            try:
                if os.path.exists(error_path):
                    os.remove(error_path)
            except OSError:
                self.logger.warning("Unable to remove temporary restore error file: %s", error_path)

    def validate_full_backup_member(self, member):
        return validate_full_backup_member(member, self.image_filename_normalizer)

    def extract_full_backup_to_temp(self, backup_path):
        temp_dir = tempfile.mkdtemp(prefix='backup_restore_')
        try:
            with tarfile.open(backup_path, 'r:gz') as tar:
                members = tar.getmembers()
                for member in members:
                    if not self.validate_full_backup_member(member):
                        raise ValueError(f'Unsafe or unsupported backup entry: {member.name}')
                    target_path = os.path.realpath(os.path.join(temp_dir, safe_tar_member_name(member.name)))
                    if not is_path_inside(temp_dir, target_path):
                        raise ValueError(f'Unsafe backup entry path: {member.name}')
                tar.extractall(temp_dir, members=members)

            manifest_path = os.path.join(temp_dir, 'manifest.json')
            dump_path = os.path.join(temp_dir, 'database.sql.gz')
            images_path = os.path.join(temp_dir, 'images')
            if not os.path.isfile(manifest_path) or not os.path.isfile(dump_path):
                raise ValueError('Full backup is missing manifest or database dump')

            with open(manifest_path, 'r', encoding='utf-8') as manifest_file:
                manifest = json.load(manifest_file)
            if manifest.get('type') != 'full' or manifest.get('database_dump') != 'database.sql.gz':
                raise ValueError('Full backup manifest is invalid')

            self.validate_extracted_images(images_path)
            return temp_dir, dump_path, images_path, manifest
        except Exception:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise

    def validate_extracted_images(self, images_path):
        if not os.path.exists(images_path):
            return
        root_path = os.path.realpath(images_path)
        for dirpath, dirnames, filenames in os.walk(root_path, followlinks=False):
            dirnames[:] = [
                dirname for dirname in dirnames
                if not os.path.islink(os.path.join(dirpath, dirname))
            ]
            for dirname in dirnames:
                relative_dir = os.path.relpath(os.path.join(dirpath, dirname), root_path).replace('\\', '/')
                if len(relative_dir.split('/')) > 1 or not (len(relative_dir) == 4 and relative_dir.isdigit()):
                    raise ValueError(f'Unsafe image directory in backup: {relative_dir}')
            for filename in filenames:
                abs_path = os.path.join(dirpath, filename)
                if os.path.islink(abs_path) or not os.path.isfile(abs_path):
                    raise ValueError(f'Unsafe image file in backup: {filename}')
                if not is_path_inside(root_path, abs_path):
                    raise ValueError(f'Unsafe image path in backup: {filename}')
                relative_path = os.path.relpath(abs_path, root_path).replace('\\', '/')
                if self.image_filename_normalizer(relative_path) != relative_path:
                    raise ValueError(f'Unsupported image path in backup: {relative_path}')

    def clear_directory_contents(self, directory_path):
        os.makedirs(directory_path, exist_ok=True)
        root_path = os.path.realpath(directory_path)
        for entry in os.scandir(root_path):
            entry_path = os.path.realpath(entry.path)
            if not is_path_inside(root_path, entry_path):
                raise ValueError(f'Unsafe path while clearing directory: {entry.name}')
            if entry.is_dir(follow_symlinks=False):
                shutil.rmtree(entry_path)
            else:
                os.remove(entry_path)

    def copy_directory_contents(self, source_dir, target_dir):
        os.makedirs(target_dir, exist_ok=True)
        if not os.path.isdir(source_dir):
            return
        for dirpath, dirnames, filenames in os.walk(source_dir, followlinks=False):
            relative_dir = os.path.relpath(dirpath, source_dir)
            target_current_dir = target_dir if relative_dir == '.' else os.path.join(target_dir, relative_dir)
            os.makedirs(target_current_dir, exist_ok=True)
            for dirname in dirnames:
                os.makedirs(os.path.join(target_current_dir, dirname), exist_ok=True)
            for filename in filenames:
                shutil.copy2(os.path.join(dirpath, filename), os.path.join(target_current_dir, filename))

    def restore_images_snapshot(self, images_path):
        upload_root = os.path.realpath(self.upload_folder)
        if not is_path_inside(os.path.dirname(upload_root), upload_root):
            raise ValueError('Upload directory is unsafe')
        self.validate_extracted_images(images_path)
        self.clear_directory_contents(upload_root)
        self.copy_directory_contents(images_path, upload_root)

    def run_full_backup_restore(self, filename):
        backup_path = self.get_backup_file_path(filename, must_exist=True)
        if not backup_path:
            raise FileNotFoundError('Backup file not found')

        temp_dir, dump_path, images_path, manifest = self.extract_full_backup_to_temp(backup_path)
        try:
            self.run_database_restore_from_path(dump_path)
            self.restore_images_snapshot(images_path)
            return {
                'backup_type': 'full',
                'type_label': '完整备份',
                'includes_images': True,
                'manifest': manifest
            }
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def run_backup_restore(self, filename):
        backup_info = self.classify_backup_filename(filename)
        if not backup_info:
            raise ValueError('Invalid backup filename')
        if backup_info['type'] == 'full':
            return self.run_full_backup_restore(filename)

        backup_path = self.get_backup_file_path(filename, must_exist=True)
        if not backup_path:
            raise FileNotFoundError('Backup file not found')
        self.run_database_restore_from_path(backup_path)
        return backup_info

    def format_backup_file(self, filename, path):
        stat = os.stat(path)
        backup_info = self.classify_backup_filename(filename) or {
            'type': 'unknown',
            'type_label': '未知',
            'includes_images': False,
            'scheduled': False
        }
        return {
            'filename': filename,
            **backup_info,
            'size_bytes': stat.st_size,
            'modified_at': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(stat.st_mtime))
        }

    def list_database_backups(self):
        os.makedirs(self.backup_dir, exist_ok=True)
        backups = []
        for entry in os.scandir(self.backup_dir):
            if not entry.is_file():
                continue
            filename = safe_backup_filename(entry.name)
            if not filename:
                continue
            backups.append(self.format_backup_file(filename, entry.path))
        backups.sort(key=lambda item: item['modified_at'], reverse=True)
        return backups

    def delete_database_backup_file(self, filename):
        safe_filename = safe_backup_filename(filename)
        if not safe_filename:
            raise ValueError('Invalid backup filename')

        backup_path = self.get_backup_file_path(safe_filename, must_exist=True)
        if not backup_path:
            raise FileNotFoundError('Backup file not found')

        os.remove(backup_path)
        return safe_filename

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
