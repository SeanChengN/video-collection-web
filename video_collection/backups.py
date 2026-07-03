import threading

from .backup_archive_ops import BackupArchiveOpsMixin, add_bytes_to_tar
from .backup_database_ops import (
    BackupDatabaseOpsMixin,
    DatabaseUpgradeRequiredError,
    database_upgrade_command_hint,
    database_upgrade_message,
    is_database_upgrade_error,
    read_process_error,
)
from .backup_scheduler import BackupSchedulerMixin
from .backup_validation import (
    BACKUP_FILENAME_PATTERN,
    SCHEDULED_BACKUP_PREFIX,
    classify_backup_filename,
    format_local_datetime,
    parse_backup_schedule_time,
    safe_backup_filename,
    safe_tar_member_name,
    validate_full_backup_member,
)


class BackupService(BackupArchiveOpsMixin, BackupDatabaseOpsMixin, BackupSchedulerMixin):
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
