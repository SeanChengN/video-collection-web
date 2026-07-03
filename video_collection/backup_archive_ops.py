import io
import json
import os
import re
import shutil
import tarfile
import tempfile
import time

from .backup_validation import (
    classify_backup_filename,
    safe_backup_filename,
    safe_tar_member_name,
    validate_full_backup_member,
)
from .paths import is_path_inside


def add_bytes_to_tar(tar, arcname, data, mtime=None):
    payload = data if isinstance(data, bytes) else data.encode('utf-8')
    info = tarfile.TarInfo(arcname)
    info.size = len(payload)
    info.mtime = int(mtime or time.time())
    tar.addfile(info, io.BytesIO(payload))


class BackupArchiveOpsMixin:
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
