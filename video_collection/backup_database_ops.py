import gzip
import os
import subprocess


class DatabaseUpgradeRequiredError(RuntimeError):
    pass


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


class BackupDatabaseOpsMixin:
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
