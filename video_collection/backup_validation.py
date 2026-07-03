import re


SCHEDULED_BACKUP_PREFIX = 'scheduled_'
BACKUP_FILENAME_PATTERN = re.compile(r'^[A-Za-z0-9_.-]+(?:\.full\.tar\.gz|\.sql(?:\.gz)?)$')


def safe_backup_filename(filename):
    filename = (filename or '').strip()
    if not filename:
        return None
    if '/' in filename or '\\' in filename or filename in {'.', '..'}:
        return None
    if not BACKUP_FILENAME_PATTERN.fullmatch(filename):
        return None
    return filename


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
