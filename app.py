import os #文件操作
import io #处理图像数据流
import hmac
import logging
import re
import gzip
import tarfile
import tempfile
import shutil
import subprocess
import threading
import mysql.connector #数据库连接
import time #时间处理
import uuid #UUID生成
import json #JSON处理
from flask import Flask, render_template, request, jsonify, send_from_directory, redirect, session, url_for #Flask框架
from contextlib import contextmanager #上下文管理器
from flask_compress import Compress #压缩代码
from PIL import Image, ImageOps, UnidentifiedImageError #图像处理
import requests
from urllib.parse import quote, urlsplit
from flask import Response, stream_with_context
from werkzeug.exceptions import RequestEntityTooLarge

app = Flask(__name__)
Compress(app)
logging.basicConfig(
    level=os.environ.get('LOG_LEVEL', 'INFO').upper(),
    format='%(asctime)s - %(levelname)s - %(name)s - %(message)s'
)
logger = logging.getLogger(__name__)

def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}

def env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default

# 图片上传常量
UPLOAD_FOLDER = '/images'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
VIDEO_LIBRARY_ROOT = os.environ.get('VIDEO_LIBRARY_ROOT', '/videos')
MAX_IMAGE_UPLOAD_MB = max(1, env_int('MAX_IMAGE_UPLOAD_MB', 10))
MAX_IMAGE_UPLOAD_BYTES = MAX_IMAGE_UPLOAD_MB * 1024 * 1024
app.config['MAX_CONTENT_LENGTH'] = MAX_IMAGE_UPLOAD_BYTES

# 允许的图片格式
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg'}
ALLOWED_STORED_IMAGE_EXTENSIONS = {'webp', 'png', 'jpg', 'jpeg'}
ALLOWED_VIDEO_EXTENSIONS = {
    'mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'flv', 'ts'
}
Image.MAX_IMAGE_PIXELS = env_int('MAX_IMAGE_PIXELS', 20000000)

# 配置压缩选项
app.config['COMPRESS_MIMETYPES'] = [
    'text/html',
    'text/css',
    'text/xml',
    'application/json',
    'application/javascript',
    'application/x-javascript'
]
app.config['COMPRESS_LEVEL'] = 6
app.config['COMPRESS_MIN_SIZE'] = 500

def json_error(message='Request failed', status=500):
    return jsonify({"success": False, "message": message}), status

def log_exception(action, exc):
    logger.exception("%s failed: %s", action, exc)

def json_exception(action, exc, message='Request failed'):
    log_exception(action, exc)
    return json_error(message, 500)

def configured_access_token():
    return os.environ.get('APP_ACCESS_TOKEN', '').strip()

def access_token_required():
    return bool(configured_access_token())

AUTH_SESSION_KEY = 'app_authenticated'
app.secret_key = configured_access_token() or os.urandom(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax'
)

def is_authenticated_session():
    return session.get(AUTH_SESSION_KEY) is True

def safe_next_path(value):
    value = (value or '/').strip()
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return '/'
    if not parsed.path.startswith('/') or parsed.path.startswith('//'):
        return '/'
    return parsed.path + (f'?{parsed.query}' if parsed.query else '')

def current_request_path():
    return request.full_path.rstrip('?') or '/'

def unauthorized_response():
    if request.path == '/api' or request.path.startswith('/api/'):
        return json_error('Unauthorized', 401)
    if request.method == 'GET' and request.accept_mimetypes.accept_html:
        return redirect(url_for('auth', next=current_request_path()))
    return Response('Unauthorized', status=401)

@app.before_request
def require_app_session_auth():
    if not access_token_required():
        return None
    if request.endpoint in {'auth', 'healthz'}:
        return None
    if is_authenticated_session():
        return None
    return unauthorized_response()

@app.route('/auth', methods=['GET', 'POST'])
def auth():
    next_path = safe_next_path(request.values.get('next', '/'))
    if not access_token_required():
        return redirect(next_path)
    if is_authenticated_session():
        return redirect(next_path)

    error = False
    if request.method == 'POST':
        provided_token = request.form.get('token', '').strip()
        if provided_token and hmac.compare_digest(provided_token, configured_access_token()):
            session[AUTH_SESSION_KEY] = True
            session.permanent = False
            return redirect(next_path)
        session.pop(AUTH_SESSION_KEY, None)
        error = True

    return render_template('auth.html', error=error, next_path=next_path), 401 if error else 200

@app.errorhandler(RequestEntityTooLarge)
def handle_request_too_large(error):
    return json_error(f'Uploaded file is too large. Max size is {MAX_IMAGE_UPLOAD_MB} MB.', 413)

def normalize_upload_filename(filename):
    filename = (filename or '').strip()
    if not filename:
        return None
    if filename.startswith('/') or '\\' in filename:
        return None
    parts = filename.split('/')
    if len(parts) not in {1, 2}:
        return None
    if any(not part or part in {'.', '..'} for part in parts):
        return None

    if len(parts) == 1:
        basename = parts[0]
        if basename != os.path.basename(basename):
            return None
        if not allowed_stored_image_file(basename):
            return None
        return basename

    year, basename = parts
    if len(year) != 4 or not year.isdigit():
        return None
    if basename != os.path.basename(basename):
        return None
    if not allowed_stored_image_file(basename):
        return None
    return f'{year}/{basename}'

def get_upload_file_path(filename):
    safe_filename = normalize_upload_filename(filename)
    if not safe_filename:
        return None

    root_path = os.path.realpath(app.config['UPLOAD_FOLDER'])
    candidate_path = os.path.realpath(os.path.join(root_path, *safe_filename.split('/')))
    try:
        if os.path.commonpath([root_path, candidate_path]) != root_path:
            return None
    except ValueError:
        return None
    return candidate_path

def delete_uploaded_image(filename):
    file_path = get_upload_file_path(filename)
    if not file_path:
        logger.warning("Rejected unsafe image delete path: %r", filename)
        return False
    if os.path.exists(file_path):
        os.remove(file_path)
        return True
    return False

def get_service_url(service_name):
    env_name = {
        'jackett': 'JACKETT_URL',
        'thunder': 'THUNDER_URL'
    }.get(service_name)
    if not env_name:
        return ''
    return os.environ.get(env_name, '').strip().rstrip('/')

def build_service_redirect_url(service_name):
    service_url = get_service_url(service_name)
    if not service_url:
        return None

    path = request.args.get('path', '').strip()
    if path and not path.startswith('/'):
        path = f'/{path}'
    if '..' in path.replace('\\', '/').split('/'):
        return None
    return f'{service_url}{path}'

# 数据库连接配置，从环境变量中读取
DB_CONFIG = {
    "host": os.environ["DB_HOST"],
    "user": os.environ["DB_USER"], 
    "password": os.environ["DB_PASSWORD"],
    "database": os.environ["DB_DATABASE"]
}
DB_BACKUP_DIR = os.environ.get('DB_BACKUP_DIR', '/backups')
DB_BACKUP_INCLUDE_ROUTINES = env_bool('DB_BACKUP_INCLUDE_ROUTINES', False)
BACKUP_FILENAME_PATTERN = re.compile(r'^[A-Za-z0-9_.-]+(?:\.full\.tar\.gz|\.sql(?:\.gz)?)$')
DB_MAINTENANCE_LOCK = threading.Lock()

EMBY_CLIENT_NAME = 'video-collection'
EMBY_DEVICE_NAME = 'video-collection-server'
EMBY_DEVICE_ID = os.environ.get('EMBY_DEVICE_ID', 'video-collection-server')
EMBY_CLIENT_VERSION = '1.0.0'
EMBY_TOKEN_CACHE = {
    'access_token': None,
    'user_id': None
}

def get_emby_server_url():
    server_url = os.environ.get('EMBY_SERVER_URL', '').strip().rstrip('/')
    if not server_url:
        raise ValueError('EMBY_SERVER_URL is not configured')
    return server_url

def get_emby_credentials():
    username = os.environ.get('EMBY_USERNAME', '').strip()
    password = os.environ.get('EMBY_PASSWORD', '')
    if not username or not password:
        raise ValueError('EMBY_USERNAME or EMBY_PASSWORD is not configured')
    return username, password

def get_emby_headers(access_token=None, accept_json=True):
    auth_value = (
        f'MediaBrowser Client="{EMBY_CLIENT_NAME}", '
        f'Device="{EMBY_DEVICE_NAME}", '
        f'DeviceId="{EMBY_DEVICE_ID}", '
        f'Version="{EMBY_CLIENT_VERSION}"'
    )
    if access_token:
        auth_value = f'{auth_value}, Token="{access_token}"'
    headers = {
        'X-Emby-Authorization': auth_value
    }
    if accept_json:
        headers['Accept'] = 'application/json'
    if access_token:
        headers['X-Emby-Token'] = access_token
    return headers

def authenticate_emby(force_refresh=False):
    if EMBY_TOKEN_CACHE['access_token'] and not force_refresh:
        return EMBY_TOKEN_CACHE['access_token'], EMBY_TOKEN_CACHE['user_id']

    server_url = get_emby_server_url()
    username, password = get_emby_credentials()
    response = requests.post(
        f'{server_url}/emby/Users/AuthenticateByName',
        json={'Username': username, 'Pw': password},
        headers=get_emby_headers(),
        timeout=10
    )

    if not response.ok:
        EMBY_TOKEN_CACHE['access_token'] = None
        EMBY_TOKEN_CACHE['user_id'] = None
        raise RuntimeError(f'Emby authentication failed: HTTP {response.status_code}')

    auth_data = response.json()
    access_token = auth_data.get('AccessToken')
    user = auth_data.get('User') or {}
    user_id = user.get('Id') or auth_data.get('UserId')
    if not access_token:
        raise RuntimeError('Emby authentication did not return an access token')

    EMBY_TOKEN_CACHE['access_token'] = access_token
    EMBY_TOKEN_CACHE['user_id'] = user_id
    return access_token, user_id

def emby_request(method, path, params=None, headers=None, stream=False, timeout=15, force_refresh=False):
    server_url = get_emby_server_url()
    access_token, _ = authenticate_emby(force_refresh)
    request_headers = get_emby_headers(access_token, accept_json=not stream)
    if headers:
        request_headers.update(headers)

    response = requests.request(
        method,
        f'{server_url}{path}',
        params=params,
        headers=request_headers,
        stream=stream,
        timeout=timeout
    )

    if response.status_code == 401 and not force_refresh:
        response.close()
        return emby_request(
            method,
            path,
            params=params,
            headers=headers,
            stream=stream,
            timeout=timeout,
            force_refresh=True
        )

    return response

@contextmanager
def get_db_connection():
    conn = mysql.connector.connect(**DB_CONFIG)
    try:
        yield conn
    finally:
        if conn.is_connected():
            conn.close()

def check_database_connection():
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        result = cursor.fetchone()
        return first_row_value(result) == 1

@app.route('/healthz')
def healthz():
    try:
        if not check_database_connection():
            raise RuntimeError('Database health query returned an unexpected result')
        return jsonify({
            'status': 'ok',
            'database': 'ok'
        })
    except Exception as e:
        logger.warning("Health check database probe failed: %s", e)
        return jsonify({
            'status': 'error',
            'database': 'error'
        }), 503

def backup_feature_enabled():
    return access_token_required() and is_authenticated_session()

def sanitized_database_name():
    value = re.sub(r'[^A-Za-z0-9_.-]+', '_', DB_CONFIG['database']).strip('._-')
    return value or 'database'

def safe_backup_filename(filename):
    filename = (filename or '').strip()
    if not filename:
        return None
    if '/' in filename or '\\' in filename or filename in {'.', '..'}:
        return None
    if not BACKUP_FILENAME_PATTERN.fullmatch(filename):
        return None
    return filename

def get_backup_file_path(filename, must_exist=False):
    safe_filename = safe_backup_filename(filename)
    if not safe_filename:
        return None

    root_path = os.path.realpath(DB_BACKUP_DIR)
    candidate_path = os.path.realpath(os.path.join(root_path, safe_filename))
    try:
        if os.path.commonpath([root_path, candidate_path]) != root_path:
            return None
    except ValueError:
        return None
    if must_exist and not os.path.isfile(candidate_path):
        return None
    return candidate_path

def backup_command_env():
    env = os.environ.copy()
    env['MYSQL_PWD'] = DB_CONFIG['password']
    return env

def read_process_error(error_path):
    try:
        with open(error_path, 'rb') as f:
            return f.read(4096).decode('utf-8', errors='replace').strip()
    except OSError:
        return ''

class DatabaseUpgradeRequiredError(RuntimeError):
    pass

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

def get_database_upgrade_diagnostics():
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SHOW FUNCTION STATUS WHERE Db = %s", (DB_CONFIG['database'],))
            cursor.fetchall()
            cursor.execute("SHOW PROCEDURE STATUS WHERE Db = %s", (DB_CONFIG['database'],))
            cursor.fetchall()
        return {
            'database_upgrade_required': False,
            'database_upgrade_message': '',
            'database_upgrade_command': ''
        }
    except Exception as e:
        error_text = str(e)
        if is_database_upgrade_error(error_text):
            logger.warning("MariaDB system table upgrade is required: %s", error_text)
            return {
                'database_upgrade_required': True,
                'database_upgrade_message': database_upgrade_message(),
                'database_upgrade_command': database_upgrade_command_hint()
            }
        logger.warning("MariaDB upgrade diagnostic failed: %s", e)
        return {
            'database_upgrade_required': False,
            'database_upgrade_message': '',
            'database_upgrade_command': ''
        }

def build_database_dump_command():
    cmd = [
        'mariadb-dump',
        '--single-transaction',
        '--triggers',
        '--default-character-set=utf8mb4',
        '-h', DB_CONFIG['host'],
        '-u', DB_CONFIG['user'],
        DB_CONFIG['database']
    ]
    if DB_BACKUP_INCLUDE_ROUTINES:
        cmd.insert(2, '--routines')
    return cmd

def classify_backup_filename(filename):
    safe_filename = safe_backup_filename(filename)
    if not safe_filename:
        return None
    if safe_filename.endswith('.full.tar.gz'):
        return {
            'type': 'full',
            'type_label': '完整备份',
            'includes_images': True
        }
    if safe_filename.endswith('.sql') or safe_filename.endswith('.sql.gz'):
        return {
            'type': 'database',
            'type_label': '仅数据库',
            'includes_images': False
        }
    return None

def add_bytes_to_tar(tar, arcname, data, mtime=None):
    payload = data if isinstance(data, bytes) else data.encode('utf-8')
    info = tarfile.TarInfo(arcname)
    info.size = len(payload)
    info.mtime = int(mtime or time.time())
    tar.addfile(info, io.BytesIO(payload))

def is_path_inside(root_path, candidate_path):
    root_path = os.path.realpath(root_path)
    candidate_path = os.path.realpath(candidate_path)
    try:
        return os.path.commonpath([root_path, candidate_path]) == root_path
    except ValueError:
        return False

def iter_safe_image_files():
    root_path = os.path.realpath(app.config['UPLOAD_FOLDER'])
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
            safe_relative_path = normalize_upload_filename(relative_path)
            if safe_relative_path != relative_path:
                logger.warning("Skipped unsafe image during backup: %s", relative_path)
                continue
            image_files.append((abs_path, safe_relative_path))

    image_files.sort(key=lambda item: item[1].lower())
    return image_files

def run_database_dump_to_file(target_path):
    temp_path = f'{target_path}.tmp'
    error_path = f'{target_path}.err'
    cmd = build_database_dump_command()

    try:
        with open(error_path, 'wb') as error_file:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=error_file,
                env=backup_command_env()
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
            logger.error("Database backup failed with exit code %s: %s", return_code, error_text)
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
                logger.warning("Unable to remove temporary backup file: %s", cleanup_path)

def run_database_backup(prefix=''):
    os.makedirs(DB_BACKUP_DIR, exist_ok=True)
    timestamp = time.strftime('%Y%m%d_%H%M%S')
    filename = f"{prefix}{sanitized_database_name()}_{timestamp}.full.tar.gz"
    target_path = get_backup_file_path(filename)
    if not target_path:
        raise ValueError('Invalid backup filename')

    temp_archive_path = f'{target_path}.tmp'
    with tempfile.TemporaryDirectory(prefix='backup_build_', dir=DB_BACKUP_DIR) as temp_dir:
        dump_path = os.path.join(temp_dir, 'database.sql.gz')
        run_database_dump_to_file(dump_path)

        image_files = iter_safe_image_files()
        manifest = {
            'version': 1,
            'type': 'full',
            'database': DB_CONFIG['database'],
            'created_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'include_routines': DB_BACKUP_INCLUDE_ROUTINES,
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
                logger.warning("Unable to remove temporary full backup file: %s", temp_archive_path)

    return format_backup_file(filename, target_path)

def run_database_restore_from_path(backup_path):
    if not backup_path or not os.path.isfile(backup_path):
        raise FileNotFoundError('Backup file not found')

    error_path = f'{backup_path}.restore.err'
    cmd = [
        'mariadb',
        '--default-character-set=utf8mb4',
        '-h', DB_CONFIG['host'],
        '-u', DB_CONFIG['user'],
        DB_CONFIG['database']
    ]
    opener = gzip.open if backup_path.endswith('.gz') else open

    try:
        with opener(backup_path, 'rb') as input_file, open(error_path, 'wb') as error_file:
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=error_file,
                env=backup_command_env()
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
            logger.error("Database restore failed with exit code %s: %s", return_code, error_text)
            raise RuntimeError('Database restore command failed')
    finally:
        try:
            if os.path.exists(error_path):
                os.remove(error_path)
        except OSError:
            logger.warning("Unable to remove temporary restore error file: %s", error_path)

def safe_tar_member_name(name):
    name = (name or '').replace('\\', '/').strip()
    if not name or name.startswith('/') or name.startswith('../'):
        return None
    parts = [part for part in name.split('/') if part]
    if not parts or any(part in {'.', '..'} for part in parts):
        return None
    return '/'.join(parts)

def validate_full_backup_member(member):
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
        return normalize_upload_filename(relative_path) == relative_path
    return False

def extract_full_backup_to_temp(backup_path):
    temp_dir = tempfile.mkdtemp(prefix='backup_restore_')
    try:
        with tarfile.open(backup_path, 'r:gz') as tar:
            members = tar.getmembers()
            for member in members:
                if not validate_full_backup_member(member):
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

        validate_extracted_images(images_path)
        return temp_dir, dump_path, images_path, manifest
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise

def validate_extracted_images(images_path):
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
            if normalize_upload_filename(relative_path) != relative_path:
                raise ValueError(f'Unsupported image path in backup: {relative_path}')

def clear_directory_contents(directory_path):
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

def copy_directory_contents(source_dir, target_dir):
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

def restore_images_snapshot(images_path):
    upload_root = os.path.realpath(app.config['UPLOAD_FOLDER'])
    if not is_path_inside(os.path.dirname(upload_root), upload_root):
        raise ValueError('Upload directory is unsafe')
    validate_extracted_images(images_path)
    clear_directory_contents(upload_root)
    copy_directory_contents(images_path, upload_root)

def run_full_backup_restore(filename):
    backup_path = get_backup_file_path(filename, must_exist=True)
    if not backup_path:
        raise FileNotFoundError('Backup file not found')

    temp_dir, dump_path, images_path, manifest = extract_full_backup_to_temp(backup_path)
    try:
        run_database_restore_from_path(dump_path)
        restore_images_snapshot(images_path)
        return {
            'backup_type': 'full',
            'type_label': '完整备份',
            'includes_images': True,
            'manifest': manifest
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

def run_backup_restore(filename):
    backup_info = classify_backup_filename(filename)
    if not backup_info:
        raise ValueError('Invalid backup filename')
    if backup_info['type'] == 'full':
        return run_full_backup_restore(filename)

    backup_path = get_backup_file_path(filename, must_exist=True)
    if not backup_path:
        raise FileNotFoundError('Backup file not found')
    run_database_restore_from_path(backup_path)
    return backup_info

def format_backup_file(filename, path):
    stat = os.stat(path)
    backup_info = classify_backup_filename(filename) or {
        'type': 'unknown',
        'type_label': '未知',
        'includes_images': False
    }
    return {
        'filename': filename,
        **backup_info,
        'size_bytes': stat.st_size,
        'modified_at': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(stat.st_mtime))
    }

def list_database_backups():
    os.makedirs(DB_BACKUP_DIR, exist_ok=True)
    backups = []
    for entry in os.scandir(DB_BACKUP_DIR):
        if not entry.is_file():
            continue
        filename = safe_backup_filename(entry.name)
        if not filename:
            continue
        backups.append(format_backup_file(filename, entry.path))
    backups.sort(key=lambda item: item['modified_at'], reverse=True)
    return backups

def delete_database_backup_file(filename):
    safe_filename = safe_backup_filename(filename)
    if not safe_filename:
        raise ValueError('Invalid backup filename')

    backup_path = get_backup_file_path(safe_filename, must_exist=True)
    if not backup_path:
        raise FileNotFoundError('Backup file not found')

    os.remove(backup_path)
    return safe_filename

MOVIE_METADATA_MIGRATION = '2026_06_18_normalize_movie_metadata'
MOVIE_IMAGES_MIGRATION = '2026_06_21_normalize_movie_images'

def table_exists(cursor, table_name):
    cursor.execute("""
        SELECT COUNT(*)
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
    """, (table_name,))
    return cursor.fetchone()[0] > 0

def column_exists(cursor, table_name, column_name):
    cursor.execute("""
        SELECT COUNT(*)
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
    """, (table_name, column_name))
    return cursor.fetchone()[0] > 0

def index_exists(cursor, table_name, index_name):
    cursor.execute("""
        SELECT COUNT(*)
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND INDEX_NAME = %s
    """, (table_name, index_name))
    return cursor.fetchone()[0] > 0

def ensure_index(cursor, table_name, index_name, create_sql):
    if not index_exists(cursor, table_name, index_name):
        cursor.execute(create_sql)

def migration_recorded(cursor, version):
    cursor.execute(
        "SELECT 1 FROM schema_migrations WHERE version = %s LIMIT 1",
        (version,)
    )
    return cursor.fetchone() is not None

def record_schema_migration(cursor, version):
    cursor.execute(
        "INSERT IGNORE INTO schema_migrations (version) VALUES (%s)",
        (version,)
    )

def parse_legacy_id_list(value):
    ids = []
    seen = set()
    for item in str(value or '').split(','):
        item = item.strip()
        if not item:
            continue
        try:
            item_id = int(item)
        except (TypeError, ValueError):
            continue
        if item_id <= 0 or item_id in seen:
            continue
        seen.add(item_id)
        ids.append(item_id)
    return ids

def parse_tag_names(value):
    names = []
    seen = set()
    for item in str(value or '').split(','):
        name = item.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        names.append(name)
    return names

def parse_ratings_string(value):
    ratings_by_dimension = {}
    for item in str(value or '').split(','):
        item = item.strip()
        if ':' not in item:
            continue
        dimension_id, rating = item.split(':', 1)
        try:
            dimension_id = int(dimension_id.strip())
            rating = int(rating.strip())
        except (TypeError, ValueError):
            continue
        if dimension_id <= 0 or rating < 1 or rating > 5:
            continue
        ratings_by_dimension[dimension_id] = rating
    return list(ratings_by_dimension.items())

def parse_image_filenames(value):
    filenames = []
    seen = set()
    for item in str(value or '').split(','):
        filename = normalize_upload_filename(item)
        if not filename or filename in seen:
            continue
        seen.add(filename)
        filenames.append(filename)
    return filenames

def parse_positive_int(value, default, minimum=1, maximum=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    if number < minimum:
        return minimum
    if maximum is not None and number > maximum:
        return maximum
    return number

def row_value(row, key='id'):
    if isinstance(row, dict):
        return row.get(key)
    return row[0]

def first_row_value(row):
    if isinstance(row, dict):
        return next(iter(row.values()))
    return row[0]

def resolve_tag_ids(cursor, tag_names):
    tag_ids = []
    for tag_name in tag_names:
        cursor.execute("SELECT id FROM tags WHERE name = %s", (tag_name,))
        result = cursor.fetchone()
        if result:
            tag_ids.append(row_value(result))
    return tag_ids

def replace_movie_tags(cursor, movie_title, tag_ids):
    cursor.execute("DELETE FROM movie_tags WHERE movie_title = %s", (movie_title,))
    for tag_id in tag_ids:
        cursor.execute("""
            INSERT IGNORE INTO movie_tags (movie_title, tag_id)
            VALUES (%s, %s)
        """, (movie_title, tag_id))

def replace_movie_ratings(cursor, movie_title, ratings_value):
    cursor.execute("DELETE FROM movie_ratings WHERE movie_title = %s", (movie_title,))
    for dimension_id, rating in parse_ratings_string(ratings_value):
        cursor.execute("""
            INSERT INTO movie_ratings (movie_title, dimension_id, rating)
            SELECT %s, id, %s
            FROM ratings_dimensions
            WHERE id = %s
            ON DUPLICATE KEY UPDATE rating = VALUES(rating)
        """, (movie_title, rating, dimension_id))

def replace_movie_images(cursor, movie_title, image_filenames_value):
    cursor.execute("DELETE FROM movie_images WHERE movie_title = %s", (movie_title,))
    for sort_order, filename in enumerate(parse_image_filenames(image_filenames_value)):
        cursor.execute("""
            INSERT INTO movie_images (movie_title, filename, sort_order)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)
        """, (movie_title, filename, sort_order))

def get_movie_image_filenames(cursor, movie_title):
    cursor.execute("""
        SELECT filename
        FROM movie_images
        WHERE movie_title = %s
        ORDER BY sort_order, filename
    """, (movie_title,))
    rows = cursor.fetchall()
    filenames = []
    for row in rows:
        filenames.append(row['filename'] if isinstance(row, dict) else row[0])
    return filenames

def delete_unreferenced_uploaded_images(cursor, filenames):
    for filename in filenames:
        safe_filename = normalize_upload_filename(filename)
        if not safe_filename:
            continue
        try:
            cursor.execute("SELECT COUNT(*) FROM movie_images WHERE filename = %s", (safe_filename,))
            if first_row_value(cursor.fetchone()) > 0:
                continue
            delete_uploaded_image(safe_filename)
        except Exception as e:
            logger.warning("Failed to delete unreferenced image %r: %s", safe_filename, e)

def sync_movie_metadata(cursor, movie_title, tag_names_value, ratings_value):
    tag_ids = resolve_tag_ids(cursor, parse_tag_names(tag_names_value))
    replace_movie_tags(cursor, movie_title, tag_ids)
    replace_movie_ratings(cursor, movie_title, ratings_value)

def hydrate_movie_rows(cursor, movies):
    if not movies:
        return movies

    titles = [movie['title'] for movie in movies]
    placeholders = ','.join(['%s'] * len(titles))

    cursor.execute(f"""
        SELECT mt.movie_title, t.name
        FROM movie_tags mt
        JOIN tags t ON t.id = mt.tag_id
        WHERE mt.movie_title IN ({placeholders})
        ORDER BY t.name
    """, titles)
    tags_by_title = {}
    for row in cursor.fetchall():
        tags_by_title.setdefault(row['movie_title'], []).append(row['name'])

    cursor.execute(f"""
        SELECT mr.movie_title, rd.id AS dimension_id, rd.name AS dimension_name, mr.rating
        FROM movie_ratings mr
        JOIN ratings_dimensions rd ON rd.id = mr.dimension_id
        WHERE mr.movie_title IN ({placeholders})
        ORDER BY rd.id
    """, titles)
    ratings_by_title = {}
    for row in cursor.fetchall():
        ratings_by_title.setdefault(row['movie_title'], []).append(row)

    cursor.execute(f"""
        SELECT movie_title, filename
        FROM movie_images
        WHERE movie_title IN ({placeholders})
        ORDER BY movie_title, sort_order, filename
    """, titles)
    images_by_title = {}
    for row in cursor.fetchall():
        images_by_title.setdefault(row['movie_title'], []).append(row['filename'])

    for movie in movies:
        title = movie['title']
        movie['image_filename'] = ','.join(images_by_title.get(title, []))
        movie['tag_names'] = ', '.join(tags_by_title.get(title, []))

        ratings = ratings_by_title.get(title, [])
        movie['ratings'] = ','.join(
            f"{rating['dimension_id']}:{rating['rating']}"
            for rating in ratings
        )
        movie['ratings_display'] = {
            rating['dimension_name']: int(rating['rating'])
            for rating in ratings
        }

        added_date = movie.get('added_date')
        if hasattr(added_date, 'strftime'):
            movie['formatted_added_date'] = added_date.strftime('%Y-%m-%d %H:%M:%S')
        else:
            movie['formatted_added_date'] = str(added_date or '')

    return movies

def resolve_rating_dimension_id(cursor, value):
    value = str(value or '').strip()
    if not value:
        return None

    if value.isdigit():
        cursor.execute("SELECT id FROM ratings_dimensions WHERE id = %s", (int(value),))
    else:
        cursor.execute("SELECT id FROM ratings_dimensions WHERE name = %s", (value,))
    result = cursor.fetchone()
    return row_value(result) if result else None

def migrate_movie_metadata_schema(conn, cursor):
    has_legacy_tags = column_exists(cursor, 'movies', 'tags')
    has_legacy_ratings = column_exists(cursor, 'movies', 'ratings')

    if not has_legacy_tags and not has_legacy_ratings:
        if not migration_recorded(cursor, MOVIE_METADATA_MIGRATION):
            record_schema_migration(cursor, MOVIE_METADATA_MIGRATION)
        return

    logger.info("Migrating legacy movies tags/ratings columns to relation tables")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS movies_legacy_backup (
            title VARCHAR(255) PRIMARY KEY,
            tags VARCHAR(255),
            ratings VARCHAR(255),
            backed_up_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    """)

    tags_expr = 'tags' if has_legacy_tags else 'NULL'
    ratings_expr = 'ratings' if has_legacy_ratings else 'NULL'
    cursor.execute(f"""
        INSERT INTO movies_legacy_backup (title, tags, ratings)
        SELECT title, {tags_expr}, {ratings_expr}
        FROM movies
        ON DUPLICATE KEY UPDATE
            tags = VALUES(tags),
            ratings = VALUES(ratings),
            backed_up_at = CURRENT_TIMESTAMP
    """)

    cursor.execute("SELECT id FROM tags")
    valid_tag_ids = {row[0] for row in cursor.fetchall()}
    cursor.execute("SELECT id FROM ratings_dimensions")
    valid_dimension_ids = {row[0] for row in cursor.fetchall()}

    cursor.execute("DELETE mt FROM movie_tags mt JOIN movies m ON m.title = mt.movie_title")
    cursor.execute("DELETE mr FROM movie_ratings mr JOIN movies m ON m.title = mr.movie_title")

    cursor.execute(f"SELECT title, {tags_expr} AS tags, {ratings_expr} AS ratings FROM movies")
    legacy_movies = cursor.fetchall()

    expected_tag_rows = 0
    expected_rating_rows = 0
    for title, legacy_tags, legacy_ratings in legacy_movies:
        tag_ids = [tag_id for tag_id in parse_legacy_id_list(legacy_tags) if tag_id in valid_tag_ids]
        for tag_id in tag_ids:
            cursor.execute("""
                INSERT IGNORE INTO movie_tags (movie_title, tag_id)
                VALUES (%s, %s)
            """, (title, tag_id))
        expected_tag_rows += len(tag_ids)

        ratings = [
            (dimension_id, rating)
            for dimension_id, rating in parse_ratings_string(legacy_ratings)
            if dimension_id in valid_dimension_ids
        ]
        for dimension_id, rating in ratings:
            cursor.execute("""
                INSERT INTO movie_ratings (movie_title, dimension_id, rating)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE rating = VALUES(rating)
            """, (title, dimension_id, rating))
        expected_rating_rows += len(ratings)

    cursor.execute("SELECT COUNT(*) FROM movie_tags mt JOIN movies m ON m.title = mt.movie_title")
    actual_tag_rows = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM movie_ratings mr JOIN movies m ON m.title = mr.movie_title")
    actual_rating_rows = cursor.fetchone()[0]

    if actual_tag_rows != expected_tag_rows or actual_rating_rows != expected_rating_rows:
        conn.rollback()
        raise RuntimeError(
            "Movie metadata migration validation failed: "
            f"tags {actual_tag_rows}/{expected_tag_rows}, "
            f"ratings {actual_rating_rows}/{expected_rating_rows}"
        )

    conn.commit()

    if has_legacy_tags:
        cursor.execute("ALTER TABLE movies DROP COLUMN tags")
    if has_legacy_ratings:
        cursor.execute("ALTER TABLE movies DROP COLUMN ratings")
    record_schema_migration(cursor, MOVIE_METADATA_MIGRATION)

def migrate_movie_images_schema(conn, cursor):
    has_legacy_image_filename = column_exists(cursor, 'movies', 'image_filename')

    if not has_legacy_image_filename:
        if not migration_recorded(cursor, MOVIE_IMAGES_MIGRATION):
            record_schema_migration(cursor, MOVIE_IMAGES_MIGRATION)
        return

    logger.info("Migrating legacy movies image_filename column to movie_images")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS movies_image_legacy_backup (
            title VARCHAR(255) PRIMARY KEY,
            image_filename TEXT,
            backed_up_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        INSERT INTO movies_image_legacy_backup (title, image_filename)
        SELECT title, image_filename
        FROM movies
        ON DUPLICATE KEY UPDATE
            image_filename = VALUES(image_filename),
            backed_up_at = CURRENT_TIMESTAMP
    """)

    cursor.execute("DELETE mi FROM movie_images mi JOIN movies m ON m.title = mi.movie_title")
    cursor.execute("SELECT title, image_filename FROM movies")
    legacy_movies = cursor.fetchall()

    expected_image_rows = 0
    for title, legacy_image_filename in legacy_movies:
        filenames = parse_image_filenames(legacy_image_filename)
        for sort_order, filename in enumerate(filenames):
            cursor.execute("""
                INSERT INTO movie_images (movie_title, filename, sort_order)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)
            """, (title, filename, sort_order))
        expected_image_rows += len(filenames)

    cursor.execute("SELECT COUNT(*) FROM movie_images mi JOIN movies m ON m.title = mi.movie_title")
    actual_image_rows = cursor.fetchone()[0]

    if actual_image_rows != expected_image_rows:
        conn.rollback()
        raise RuntimeError(
            "Movie images migration validation failed: "
            f"images {actual_image_rows}/{expected_image_rows}"
        )

    conn.commit()

    cursor.execute("ALTER TABLE movies DROP COLUMN image_filename")
    record_schema_migration(cursor, MOVIE_IMAGES_MIGRATION)

# 初始化数据库
def init_db():
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # 创建movies表 - tags字段和ratings字段存储逗号分隔的ID和值
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS movies (
                    title VARCHAR(255) PRIMARY KEY,
                    recommended BOOLEAN,
                    review TEXT,
                    added_date DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version VARCHAR(100) PRIMARY KEY,
                    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # 创建tags表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS tags (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(50) UNIQUE
                )
            """)
            # 创建ratings_dimensions表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ratings_dimensions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(50) UNIQUE
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS movie_tags (
                    movie_title VARCHAR(255) NOT NULL,
                    tag_id INT NOT NULL,
                    PRIMARY KEY (movie_title, tag_id),
                    CONSTRAINT fk_movie_tags_movie
                        FOREIGN KEY (movie_title) REFERENCES movies(title)
                        ON DELETE CASCADE ON UPDATE CASCADE,
                    CONSTRAINT fk_movie_tags_tag
                        FOREIGN KEY (tag_id) REFERENCES tags(id)
                        ON DELETE CASCADE ON UPDATE CASCADE
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS movie_ratings (
                    movie_title VARCHAR(255) NOT NULL,
                    dimension_id INT NOT NULL,
                    rating TINYINT NOT NULL,
                    PRIMARY KEY (movie_title, dimension_id),
                    CONSTRAINT fk_movie_ratings_movie
                        FOREIGN KEY (movie_title) REFERENCES movies(title)
                        ON DELETE CASCADE ON UPDATE CASCADE,
                    CONSTRAINT fk_movie_ratings_dimension
                        FOREIGN KEY (dimension_id) REFERENCES ratings_dimensions(id)
                        ON DELETE CASCADE ON UPDATE CASCADE,
                    CONSTRAINT chk_movie_rating_range CHECK (rating BETWEEN 1 AND 5)
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS movie_images (
                    movie_title VARCHAR(255) NOT NULL,
                    filename VARCHAR(255) NOT NULL,
                    sort_order INT NOT NULL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (movie_title, filename),
                    CONSTRAINT fk_movie_images_movie
                        FOREIGN KEY (movie_title) REFERENCES movies(title)
                        ON DELETE CASCADE ON UPDATE CASCADE
                )
            """)

            ensure_index(cursor, 'movies', 'idx_movies_added_date', """
                CREATE INDEX idx_movies_added_date ON movies (added_date)
            """)
            ensure_index(cursor, 'movie_tags', 'idx_movie_tags_tag_movie', """
                CREATE INDEX idx_movie_tags_tag_movie ON movie_tags (tag_id, movie_title)
            """)
            ensure_index(cursor, 'movie_ratings', 'idx_movie_ratings_dimension_rating_title', """
                CREATE INDEX idx_movie_ratings_dimension_rating_title
                ON movie_ratings (dimension_id, rating, movie_title)
            """)
            ensure_index(cursor, 'movie_ratings', 'idx_movie_ratings_movie_rating', """
                CREATE INDEX idx_movie_ratings_movie_rating
                ON movie_ratings (movie_title, rating)
            """)
            ensure_index(cursor, 'movie_images', 'idx_movie_images_movie_sort', """
                CREATE INDEX idx_movie_images_movie_sort
                ON movie_images (movie_title, sort_order)
            """)
            ensure_index(cursor, 'movie_images', 'idx_movie_images_filename', """
                CREATE INDEX idx_movie_images_filename ON movie_images (filename)
            """)
            
            # 预设标签
            default_tags = [
                "精品", "剧情", "写实", "激烈", 
                "抽象", "情感", "蒙面"
            ]
            
            # 预设评分维度
            default_dimensions = [
                "颜值", "身材", "皮肤", "表演", "画面", "剧情"
            ]

            # 检查tags表是否为空
            cursor.execute("SELECT COUNT(*) FROM tags")
            tags_count = cursor.fetchone()[0]
            
            # 检查ratings_dimensions表是否为空
            cursor.execute("SELECT COUNT(*) FROM ratings_dimensions")
            ratings_count = cursor.fetchone()[0]
            
            # 插入预设标签（表为空时）
            if tags_count == 0:
                for tag in default_tags:
                    try:
                        cursor.execute("INSERT INTO tags (name) VALUES (%s)", (tag,))
                    except mysql.connector.Error as err:
                        if err.errno != 1062:  # 忽略重复键错误
                            raise
            
            # 插入预设评分维度（表为空时）
            if ratings_count == 0:
                for dimension in default_dimensions:
                    try:
                        cursor.execute("INSERT INTO ratings_dimensions (name) VALUES (%s)", (dimension,))
                    except mysql.connector.Error as err:
                        if err.errno != 1062:  # 忽略重复键错误
                            raise
                        
            migrate_movie_metadata_schema(conn, cursor)
            migrate_movie_images_schema(conn, cursor)
            conn.commit()
            return True
    except Exception as e:
        log_exception('Database initialization', e)
        return False

@app.route("/")
def index():
    return render_template("index.html")  # 确保 index.html 存在于 templates 文件夹中

# src目录的静态文件路由
@app.route('/src/<path:filename>')
def serve_src(filename):
    return send_from_directory('src', filename)

# 图片文件路由
@app.route('/images/<path:filename>')
def serve_image(filename):
    safe_filename = normalize_upload_filename(filename)
    if not safe_filename:
        return Response(status=404)
    return send_from_directory(app.config['UPLOAD_FOLDER'], safe_filename, conditional=True)

def normalize_video_relative_path(path_value=''):
    rel_path = (path_value or '').strip().replace('\\', '/').strip('/')
    if not rel_path or rel_path == '.':
        return ''

    parts = []
    for part in rel_path.split('/'):
        if not part or part == '.':
            continue
        if part == '..':
            return None
        parts.append(part)
    return '/'.join(parts)

def get_video_library_abs_path(relative_path=''):
    safe_relative = normalize_video_relative_path(relative_path)
    if safe_relative is None:
        return None

    root_path = os.path.realpath(VIDEO_LIBRARY_ROOT)
    candidate_path = os.path.realpath(os.path.join(root_path, *safe_relative.split('/'))) if safe_relative else root_path
    try:
        if os.path.commonpath([root_path, candidate_path]) != root_path:
            return None
    except ValueError:
        return None
    return candidate_path

def allowed_video_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_VIDEO_EXTENSIONS

def format_video_file_item(directory_relative_path, filename):
    relative_path = '/'.join(part for part in [directory_relative_path, filename] if part)
    abs_path = get_video_library_abs_path(relative_path)
    stat_result = os.stat(abs_path)
    return {
        'name': filename,
        'path': relative_path,
        'size': stat_result.st_size,
        'modified': int(stat_result.st_mtime),
        'url': f"/videos/{quote(relative_path, safe='/')}"
    }

@app.route('/videos/<path:filename>')
def serve_video(filename):
    safe_relative = normalize_video_relative_path(filename)
    if not safe_relative or not allowed_video_file(safe_relative):
        return Response(status=404)

    abs_path = get_video_library_abs_path(safe_relative)
    if not abs_path or not os.path.isfile(abs_path):
        return Response(status=404)

    return send_from_directory(
        os.path.dirname(abs_path),
        os.path.basename(abs_path),
        conditional=True,
        as_attachment=False
    )

@app.route('/emby/image/<item_id>')
def serve_emby_image(item_id):
    try:
        image_tag = request.args.get('tag', '').strip()
        params = {'tag': image_tag} if image_tag else None
        upstream = emby_request(
            'GET',
            f'/emby/Items/{item_id}/Images/Primary',
            params=params,
            stream=True,
            timeout=20
        )

        if upstream.status_code == 404:
            upstream.close()
            return Response(status=404)
        if not upstream.ok:
            status_code = upstream.status_code
            upstream.close()
            return Response(status=status_code)

        response_headers = {
            'Content-Type': upstream.headers.get('Content-Type', 'image/jpeg'),
            'Cache-Control': 'private, max-age=86400'
        }
        if upstream.headers.get('Content-Length'):
            response_headers['Content-Length'] = upstream.headers['Content-Length']

        def generate():
            try:
                for chunk in upstream.iter_content(chunk_size=8192):
                    if chunk:
                        yield chunk
            finally:
                upstream.close()

        return Response(stream_with_context(generate()), headers=response_headers)
    except Exception as e:
        log_exception('Emby image proxy', e)
        return Response(status=502)

@app.route('/emby/stream/<item_id>')
def stream_emby_video(item_id):
    try:
        upstream_headers = {}
        range_header = request.headers.get('Range')
        if range_header:
            upstream_headers['Range'] = range_header

        upstream = emby_request(
            'GET',
            f'/emby/Videos/{item_id}/stream',
            params={'Static': 'true'},
            headers=upstream_headers,
            stream=True,
            timeout=(10, 60)
        )

        if upstream.status_code not in (200, 206):
            status_code = upstream.status_code
            upstream.close()
            return Response('Unable to stream this Emby item', status=status_code)

        response_headers = {}
        for header_name in (
            'Content-Type',
            'Content-Length',
            'Content-Range',
            'Accept-Ranges',
            'ETag',
            'Last-Modified'
        ):
            if upstream.headers.get(header_name):
                response_headers[header_name] = upstream.headers[header_name]
        response_headers.setdefault('Accept-Ranges', 'bytes')

        def generate():
            try:
                for chunk in upstream.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        yield chunk
            finally:
                upstream.close()

        return Response(
            stream_with_context(generate()),
            status=upstream.status_code,
            headers=response_headers,
            direct_passthrough=True
        )
    except Exception as e:
        log_exception('Emby stream proxy', e)
        return Response('Unable to stream this Emby item', status=502)

@app.route('/services/<service_name>')
def service_redirect(service_name):
    target_url = build_service_redirect_url(service_name)
    if not target_url:
        return Response(status=404)
    return redirect(target_url)

# 统一api入口
@app.route('/api', methods=['POST'])
def api_handler():
    try:
        # 检查是否为图片上传请求
        if request.files:
            return upload_image_handler(None)
        
        # JSON请求
        payload = request.get_json(silent=True) or {}
        event_id = payload.get('e')
        data = payload.get('d', {})
        method = payload.get('m', 'POST') # 获取原始method
        
        handlers = {
            1001: get_services_config_handler,
            1002: get_tags_handler,
            1003: get_ratings_dimensions_handler,
            1004: add_tag_handler,
            1005: update_tag_handler,
            1006: add_rating_dimension_handler,
            1007: update_rating_dimension_handler,
            1008: add_movie_handler,
            1009: check_duplicates_handler,
            1010: upload_image_handler,
            1011: search_movies_handler,
            1012: update_movie_handler,
            1013: delete_movie_handler,
            1014: search_emby_handler,
            1015: list_video_files_handler,
            1016: delete_tag_handler,
            1017: delete_rating_dimension_handler,
            1018: list_db_backups_handler,
            1019: create_db_backup_handler,
            1020: restore_db_backup_handler,
            1021: delete_db_backup_handler
        }
        
        handler = handlers.get(event_id)
        if not handler:
            return jsonify({"success": False, "message": "无效的事件ID"}), 400
            
        return handler(data, method) # 传递method给处理器
        
    except Exception as e:
        return json_exception('API handler', e)

def add_movie_handler(data, method='POST'):
    try:
        title = data.get('title')
        recommended = 1 if data.get('recommended') else 0
        review = data.get('review', '')
        ratings = data.get('ratings', '')
        image_filenames = data.get('image_filenames', '')

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO movies (title, recommended, review)
                VALUES (%s, %s, %s)
            """, (title, recommended, review))
            replace_movie_images(cursor, title, image_filenames)
            sync_movie_metadata(cursor, title, data.get('tags', ''), ratings)
            conn.commit()
        return jsonify({"message": "电影添加成功"}), 200
    except mysql.connector.Error as err:
        log_exception('Add movie', err)
        return jsonify({"error": "电影添加失败"}), 500

def update_movie_handler(data, method='PUT'):
    try:
        title = data.get('title')
        recommended = 1 if data.get('recommended') else 0
        review = data.get('review', '')
        ratings = data.get('ratings', '')
        image_filenames = data.get('image_filenames', '')
        original_images = json.loads(data.get('original_images', '[]'))
        if not isinstance(original_images, list):
            original_images = []
        current_images = set(parse_image_filenames(image_filenames))
        original_images_set = {
            filename
            for filename in (normalize_upload_filename(filename) for filename in original_images)
            if filename
        }
        images_to_delete = original_images_set - current_images

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 更新数据库记录
            cursor.execute("""
                UPDATE movies 
                SET recommended = %s, review = %s
                WHERE title = %s
            """, (recommended, review, title))
            replace_movie_images(cursor, title, image_filenames)
            sync_movie_metadata(cursor, title, data.get('tags', ''), ratings)
            conn.commit()
            delete_unreferenced_uploaded_images(cursor, images_to_delete)
			
        return jsonify({"message": "电影更新成功"}), 200

    except Exception as e:
        return json_exception('Update movie', e, '电影更新失败')

def get_ratings_dimensions_handler(data, method='GET'):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT * FROM ratings_dimensions ORDER BY id")
            dimensions = cursor.fetchall()
            return jsonify({"success": True, "dimensions": dimensions})
    except Exception as e:
        return json_exception('Get ratings dimensions', e)

def search_movies_sql_handler(data):
    data = data or {}
    search_term = str(data.get('title') or '').strip()
    rating_dimension = str(data.get('rating_dimension') or '').strip()
    min_rating_raw = str(data.get('min_rating') or '').strip()
    selected_tag_names = parse_tag_names(data.get('tags', ''))
    page = parse_positive_int(data.get('page'), 1, 1)
    per_page = parse_positive_int(data.get('per_page'), 10, 1, 100)

    with get_db_connection() as conn:
        cursor = conn.cursor(dictionary=True)
        where_clauses = []
        params = []

        if search_term:
            where_clauses.append("(m.title LIKE %s OR m.review LIKE %s)")
            params.extend([f'%{search_term}%', f'%{search_term}%'])

        if selected_tag_names:
            tag_ids = resolve_tag_ids(cursor, selected_tag_names)
            if len(tag_ids) != len(selected_tag_names):
                return jsonify({
                    "success": True,
                    "data": [],
                    "pagination": {
                        "page": 1,
                        "per_page": per_page,
                        "total": 0,
                        "total_pages": 0
                    }
                })

            for index, tag_id in enumerate(tag_ids):
                alias = f"mt_filter_{index}"
                where_clauses.append(
                    f"EXISTS (SELECT 1 FROM movie_tags {alias} "
                    f"WHERE {alias}.movie_title = m.title AND {alias}.tag_id = %s)"
                )
                params.append(tag_id)

        min_rating = None
        if min_rating_raw:
            min_rating = parse_positive_int(min_rating_raw, None, 1, 5)
            if min_rating is None:
                return json_error('Invalid minimum rating', 400)

        rating_dimension_id = None
        if rating_dimension:
            rating_dimension_id = resolve_rating_dimension_id(cursor, rating_dimension)
            if rating_dimension_id is None:
                return jsonify({
                    "success": True,
                    "data": [],
                    "pagination": {
                        "page": 1,
                        "per_page": per_page,
                        "total": 0,
                        "total_pages": 0
                    }
                })

        if min_rating is not None and rating_dimension_id is not None:
            where_clauses.append("""
                EXISTS (
                    SELECT 1
                    FROM movie_ratings mr_filter
                    WHERE mr_filter.movie_title = m.title
                      AND mr_filter.dimension_id = %s
                      AND mr_filter.rating >= %s
                )
            """)
            params.extend([rating_dimension_id, min_rating])
        elif min_rating is not None:
            where_clauses.append("""
                EXISTS (
                    SELECT 1
                    FROM movie_ratings mr_any
                    WHERE mr_any.movie_title = m.title
                )
            """)
            where_clauses.append("""
                NOT EXISTS (
                    SELECT 1
                    FROM movie_ratings mr_low
                    WHERE mr_low.movie_title = m.title
                      AND mr_low.rating < %s
                )
            """)
            params.append(min_rating)

        where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        cursor.execute(f"SELECT COUNT(*) AS total FROM movies m{where_sql}", params)
        total = cursor.fetchone()['total']
        total_pages = (total + per_page - 1) // per_page if total else 0
        if total_pages and page > total_pages:
            page = total_pages
        offset = (page - 1) * per_page if total else 0

        query_params = list(params)
        query_params.extend([per_page, offset])
        cursor.execute(f"""
            SELECT m.title, m.recommended, m.review, m.added_date
            FROM movies m
            {where_sql}
            ORDER BY m.added_date DESC
            LIMIT %s OFFSET %s
        """, query_params)
        movies = hydrate_movie_rows(cursor, cursor.fetchall())

        return jsonify({
            "success": True,
            "data": movies,
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "total_pages": total_pages
            }
        })

def search_movies_handler(data, method='GET'):
    try:
        return search_movies_sql_handler(data)
    except Exception as e:
        return json_exception('Search movies', e, '搜索失败')

def get_tags_handler(data, method='GET'):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT id, name FROM tags")
            tags = [tag['name'] for tag in cursor.fetchall()]
            return jsonify({"success": True, "data": tags})
    except Exception as e:
        return json_exception('Get tags', e)

# 从环境变量中读取参数
def get_services_config_handler(data, method='GET'):
    try:
        return jsonify({
            'success': True,
            'data': {
                'auth_required': access_token_required(),
                'services': {
                    'emby': bool(os.environ.get('EMBY_SERVER_URL', '').strip()),
                    'jackett': bool(get_service_url('jackett')),
                    'thunder': bool(get_service_url('thunder'))
                },
                'service_routes': {
                    'jackett': '/services/jackett',
                    'thunder': '/services/thunder'
                }
            }
        })
    except Exception as e:
            return json_exception('Get services config', e)

# 相似度计算相关代码
def search_emby_handler(data, method='POST'):
    try:
        query = data.get('query', '').strip()
        if not query:
            return jsonify({"success": False, "message": "Search query is required"}), 400

        response = emby_request(
            'GET',
            '/emby/Items',
            params={
                'Recursive': 'true',
                'IncludeItemTypes': 'Movie',
                'NameStartsWith': query
            }
        )

        if not response.ok:
            status_code = response.status_code
            response.close()
            return jsonify({
                "success": False,
                "message": f"Emby search failed: HTTP {status_code}"
            }), status_code

        emby_data = response.json()
        items = []
        for item in emby_data.get('Items', []):
            item_id = str(item.get('Id', '')).strip()
            if not item_id:
                continue

            image_tag = (item.get('ImageTags') or {}).get('Primary', '')
            image_url = f'/emby/image/{quote(item_id, safe="")}'
            if image_tag:
                image_url = f'{image_url}?tag={quote(str(image_tag), safe="")}'

            items.append({
                'id': item_id,
                'name': item.get('Name', ''),
                'runtimeTicks': item.get('RunTimeTicks'),
                'imageTag': image_tag,
                'imageUrl': image_url,
                'streamUrl': f'/emby/stream/{quote(item_id, safe="")}'
            })

        return jsonify({
            "success": True,
            "data": {
                "items": items,
                "totalRecordCount": emby_data.get('TotalRecordCount', len(items))
            }
        })
    except Exception as e:
        return json_exception('Emby search', e, 'Emby search failed')

def check_title_match(title1, title2):
    # 转换为小写进行比较
    t1 = title1.lower()
    t2 = title2.lower()

    # 如果标题1以 "FC2-" 开头，取最后一个部分
    if t1.startswith('fc2-'):
        t1 = t1.split('-')[-1]
    
    # 如果标题2以 "FC2-" 开头，取最后一个部分
    if t2.startswith('fc2-'):
        t2 = t2.split('-')[-1]

    # 两者互相包含都算匹配
    return t1 in t2 or t2 in t1

# 查重核对相关代码
def check_duplicates_handler(data, method='POST'): 
    try:
        titles = data.get('titles', [])
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT title FROM movies")
            existing_titles = [row[0] for row in cursor.fetchall()]
            
            duplicates = []
            matched_titles = {}
            
            for title in titles:
                # 检查完全匹配
                if title in existing_titles:
                    duplicates.append(title)
                    matched_titles[title] = title
                    continue
                
                # 检查互相包含匹配
                for existing in existing_titles:
                    if check_title_match(title, existing):
                        duplicates.append(title)
                        matched_titles[title] = existing
                        break
            
            return jsonify({
                "success": True,
                "duplicates": duplicates,
                "matched_titles": matched_titles
            })
    except Exception as e:
        return json_exception('Check duplicates', e)

# 设置功能相关代码
def add_tag_handler(data, method='POST'):
    try:
        name = data.get('name', '').strip()
        
        if not name:
            return jsonify({"success": False, "message": "标签名称不能为空"}), 400
            
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO tags (name) VALUES (%s)", (name,))
            conn.commit()
            
        return jsonify({"success": True})
    except mysql.connector.Error as err:
        if err.errno == 1062:  # 重复键错误
            return jsonify({"success": False, "message": "标签名称已存在"}), 400
        log_exception('Add tag', err)
        return json_error('标签添加失败', 500)

def update_tag_handler(data, method='POST'):
    try:
        old_name = data.get('old_name', '').strip()
        new_name = data.get('new_name', '').strip()
        
        if not old_name or not new_name:
            return jsonify({"success": False, "message": "标签名称不能为空"}), 400
            
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE tags SET name = %s WHERE name = %s", (new_name, old_name))
            conn.commit()
            
        return jsonify({"success": True})
    except mysql.connector.Error as err:
        if err.errno == 1062:  # 重复键错误
            return jsonify({"success": False, "message": "标签名称已存在"}), 400
        log_exception('Update tag', err)
        return json_error('标签更新失败', 500)

def delete_tag_handler(data, method='DELETE'):
    try:
        data = data or {}
        name = data.get('name', '').strip()
        preview = bool(data.get('preview'))
        confirm = bool(data.get('confirm'))

        if not name:
            return jsonify({"success": False, "message": "标签名称不能为空"}), 400

        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT id, name FROM tags WHERE name = %s", (name,))
            tag = cursor.fetchone()
            if not tag:
                return jsonify({"success": False, "message": "标签不存在"}), 404

            cursor.execute(
                "SELECT COUNT(DISTINCT movie_title) AS usage_count FROM movie_tags WHERE tag_id = %s",
                (tag['id'],)
            )
            usage_count = cursor.fetchone()['usage_count']

            if preview or not confirm:
                return jsonify({
                    "success": True,
                    "exists": True,
                    "usage_count": usage_count,
                    "name": tag['name']
                })

            cursor.execute("DELETE FROM movie_tags WHERE tag_id = %s", (tag['id'],))
            cursor.execute("DELETE FROM tags WHERE id = %s", (tag['id'],))
            conn.commit()

        return jsonify({"success": True, "usage_count": usage_count})
    except Exception as e:
        return json_exception('Delete tag', e, '标签删除失败')

def add_rating_dimension_handler(data, method='POST'):
    try:
        name = data.get('name', '').strip()
        
        if not name:
            return jsonify({"success": False, "message": "评分维度名称不能为空"}), 400
            
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO ratings_dimensions (name) VALUES (%s)", (name,))
            conn.commit()
            
        return jsonify({"success": True})
    except mysql.connector.Error as err:
        if err.errno == 1062:  # 重复键错误
            return jsonify({"success": False, "message": "评分维度名称已存在"}), 400
        log_exception('Add rating dimension', err)
        return json_error('评分维度添加失败', 500)

def update_rating_dimension_handler(data, method='POST'):
    try:
        old_name = data.get('old_name', '').strip()
        new_name = data.get('new_name', '').strip()
        
        if not old_name or not new_name:
            return jsonify({"success": False, "message": "评分维度名称不能为空"}), 400
            
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE ratings_dimensions SET name = %s WHERE name = %s", (new_name, old_name))
            conn.commit()
            # 这里没有检查是否真的更新了记录
            
        return jsonify({"success": True})
    except mysql.connector.Error as err:
        if err.errno == 1062:  # 重复键错误
            return jsonify({"success": False, "message": "评分维度名称已存在"}), 400
        log_exception('Update rating dimension', err)
        return json_error('评分维度更新失败', 500)

def delete_rating_dimension_handler(data, method='DELETE'):
    try:
        data = data or {}
        dimension_id = parse_positive_int(data.get('id') or data.get('dimension_id'), None, 1)
        preview = bool(data.get('preview'))
        confirm = bool(data.get('confirm'))

        if dimension_id is None:
            return jsonify({"success": False, "message": "评分维度无效"}), 400

        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT id, name FROM ratings_dimensions WHERE id = %s", (dimension_id,))
            dimension = cursor.fetchone()
            if not dimension:
                return jsonify({"success": False, "message": "评分维度不存在"}), 404

            cursor.execute(
                "SELECT COUNT(DISTINCT movie_title) AS usage_count FROM movie_ratings WHERE dimension_id = %s",
                (dimension_id,)
            )
            usage_count = cursor.fetchone()['usage_count']

            if preview or not confirm:
                return jsonify({
                    "success": True,
                    "exists": True,
                    "usage_count": usage_count,
                    "id": dimension['id'],
                    "name": dimension['name']
                })

            cursor.execute("DELETE FROM movie_ratings WHERE dimension_id = %s", (dimension_id,))
            cursor.execute("DELETE FROM ratings_dimensions WHERE id = %s", (dimension_id,))
            conn.commit()

        return jsonify({"success": True, "usage_count": usage_count})
    except Exception as e:
        return json_exception('Delete rating dimension', e, '评分维度删除失败')

def delete_movie_handler(data, method='DELETE'):
    try:
        title = data.get('title')
        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            
            # 首先检查电影是否存在
            cursor.execute("SELECT title FROM movies WHERE title = %s", (title,))
            if not cursor.fetchone():
                return jsonify({"success": False, "message": "电影名称不存在"}), 404
            
            image_files = get_movie_image_filenames(cursor, title)

            # 删除数据库记录
            cursor.execute("DELETE FROM movie_tags WHERE movie_title = %s", (title,))
            cursor.execute("DELETE FROM movie_ratings WHERE movie_title = %s", (title,))
            cursor.execute("DELETE FROM movie_images WHERE movie_title = %s", (title,))
            cursor.execute("DELETE FROM movies WHERE title = %s", (title,))
            conn.commit()
            delete_unreferenced_uploaded_images(cursor, image_files)
            
            return jsonify({"success": True, "message": "电影删除成功"})

    except Exception as e:
        log_exception('Delete movie', e)
        return jsonify({"success": False, "message": "删除操作失败"}), 500

def list_db_backups_handler(data, method='GET'):
    try:
        database_status = 'ok'
        upgrade_diagnostics = get_database_upgrade_diagnostics()
        try:
            check_database_connection()
        except Exception as e:
            database_status = 'error'
            logger.warning("Maintenance database probe failed: %s", e)

        if not access_token_required():
            return jsonify({
                "success": True,
                "maintenance_enabled": False,
                "database_status": database_status,
                "backups": [],
                **upgrade_diagnostics
            })

        return jsonify({
            "success": True,
            "maintenance_enabled": True,
            "database_status": database_status,
            "backups": list_database_backups(),
            **upgrade_diagnostics
        })
    except Exception as e:
        return json_exception('List database backups', e, '备份列表读取失败')

def create_db_backup_handler(data, method='POST'):
    if not backup_feature_enabled():
        return jsonify({"success": False, "message": "请先配置 APP_ACCESS_TOKEN 后再使用备份功能"}), 403

    if not DB_MAINTENANCE_LOCK.acquire(blocking=False):
        return jsonify({"success": False, "message": "已有数据库维护任务正在执行，请稍后再试"}), 409

    try:
        backup = run_database_backup()
        return jsonify({
            "success": True,
            "message": "完整备份已创建",
            "backup": backup,
            "backups": list_database_backups()
        })
    except FileNotFoundError as e:
        log_exception('Create database backup', e)
        return json_error('数据库备份工具不可用，请确认容器已安装 mariadb-client', 500)
    except DatabaseUpgradeRequiredError as e:
        logger.warning("Create database backup requires MariaDB upgrade: %s", e)
        return jsonify({
            "success": False,
            "message": str(e),
            "database_upgrade_required": True,
            "database_upgrade_command": database_upgrade_command_hint()
        }), 500
    except Exception as e:
        return json_exception('Create database backup', e, '数据库备份失败')
    finally:
        DB_MAINTENANCE_LOCK.release()

def restore_db_backup_handler(data, method='POST'):
    if not backup_feature_enabled():
        return jsonify({"success": False, "message": "请先配置 APP_ACCESS_TOKEN 后再使用恢复功能"}), 403

    data = data or {}
    filename = safe_backup_filename(data.get('filename', ''))
    confirm = bool(data.get('confirm'))
    if not filename:
        return jsonify({"success": False, "message": "备份文件名无效"}), 400
    if not confirm:
        return jsonify({"success": False, "message": "请确认后再执行恢复"}), 400
    if not get_backup_file_path(filename, must_exist=True):
        return jsonify({"success": False, "message": "备份文件不存在"}), 404

    if not DB_MAINTENANCE_LOCK.acquire(blocking=False):
        return jsonify({"success": False, "message": "已有数据库维护任务正在执行，请稍后再试"}), 409

    try:
        pre_restore_backup = run_database_backup(prefix='pre_restore_')
        restore_result = run_backup_restore(filename)
        return jsonify({
            "success": True,
            "message": "备份恢复已完成",
            "pre_restore_backup": pre_restore_backup,
            "restored_backup": restore_result
        })
    except FileNotFoundError as e:
        log_exception('Restore database backup', e)
        return json_error('数据库恢复工具或备份文件不可用', 500)
    except DatabaseUpgradeRequiredError as e:
        logger.warning("Restore pre-backup requires MariaDB upgrade: %s", e)
        return jsonify({
            "success": False,
            "message": str(e),
            "database_upgrade_required": True,
            "database_upgrade_command": database_upgrade_command_hint()
        }), 500
    except Exception as e:
        return json_exception('Restore database backup', e, '数据库恢复失败')
    finally:
        DB_MAINTENANCE_LOCK.release()

def delete_db_backup_handler(data, method='DELETE'):
    if not backup_feature_enabled():
        return jsonify({"success": False, "message": "请先配置 APP_ACCESS_TOKEN 后再使用备份删除功能"}), 403

    data = data or {}
    filename = safe_backup_filename(data.get('filename', ''))
    confirm = bool(data.get('confirm'))
    if not filename:
        return jsonify({"success": False, "message": "备份文件名无效"}), 400
    if not confirm:
        return jsonify({"success": False, "message": "请确认后再删除备份"}), 400

    if not DB_MAINTENANCE_LOCK.acquire(blocking=False):
        return jsonify({"success": False, "message": "已有数据库维护任务正在执行，请稍后再试"}), 409

    try:
        deleted_filename = delete_database_backup_file(filename)
        return jsonify({
            "success": True,
            "message": "备份文件已删除",
            "deleted_filename": deleted_filename,
            "backups": list_database_backups()
        })
    except FileNotFoundError:
        return jsonify({"success": False, "message": "备份文件不存在"}), 404
    except ValueError:
        return jsonify({"success": False, "message": "备份文件名无效"}), 400
    except Exception as e:
        return json_exception('Delete database backup', e, '备份删除失败')
    finally:
        DB_MAINTENANCE_LOCK.release()

# 图片文件验证
def list_video_files_handler(data, method='POST'):
    try:
        relative_path = normalize_video_relative_path((data or {}).get('path', ''))
        if relative_path is None:
            return jsonify({"success": False, "message": "Invalid video directory"}), 400

        directory_path = get_video_library_abs_path(relative_path)
        if not directory_path or not os.path.isdir(directory_path):
            return jsonify({
                "success": True,
                "path": relative_path,
                "parent": normalize_video_relative_path(os.path.dirname(relative_path)) if relative_path else '',
                "directories": [],
                "files": [],
                "message": "Video directory is not available"
            })

        directories = []
        files = []
        for entry in os.scandir(directory_path):
            if entry.name.startswith('.'):
                continue

            entry_relative_path = '/'.join(part for part in [relative_path, entry.name] if part)
            try:
                if entry.is_dir(follow_symlinks=False):
                    directories.append({
                        'name': entry.name,
                        'path': entry_relative_path
                    })
                elif entry.is_file(follow_symlinks=False) and allowed_video_file(entry.name):
                    files.append(format_video_file_item(relative_path, entry.name))
            except OSError:
                continue

        directories.sort(key=lambda item: item['name'].lower())
        files.sort(key=lambda item: item['name'].lower())

        return jsonify({
            "success": True,
            "path": relative_path,
            "parent": normalize_video_relative_path(os.path.dirname(relative_path)) if relative_path else '',
            "directories": directories,
            "files": files
        })
    except Exception as e:
        return json_exception('List video files', e, 'Unable to list video files')

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def allowed_stored_image_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_STORED_IMAGE_EXTENSIONS

def process_image(image_file):
    image_file.stream.seek(0)
    with Image.open(image_file.stream) as candidate:
        candidate.verify()

    image_file.stream.seek(0)
    with Image.open(image_file.stream) as img:
        img = ImageOps.exif_transpose(img)
        width, height = img.size
        if not width or not height:
            raise ValueError('Invalid image dimensions')

        target_height = 720
        if height > target_height:
            ratio = target_height / height
            new_width = max(1, int(width * ratio))
            img = img.resize((new_width, target_height), Image.Resampling.LANCZOS)

        if img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGB')

        output = io.BytesIO()
        img.save(output, format='WebP', quality=85, optimize=True)
        return output.getvalue()

def upload_image_handler(data, method='POST'):
    if 'image' not in request.files:
        return jsonify({'success': False, 'message': '没有文件'}), 400
        
    file = request.files['image']
 
    if not file or not allowed_file(file.filename):
        return jsonify({'success': False, 'message': '仅支持 PNG/JPG/JPEG 图片'}), 400

    timestamp = int(time.time())
    unique_id = str(uuid.uuid4())[:8]
    image_year = time.strftime('%Y', time.localtime(timestamp))
    filename = f"{image_year}/{timestamp}_{unique_id}.webp"
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

    try:
        processed_image = process_image(file)
        file_path = get_upload_file_path(filename)
        if not file_path:
            logger.error("Generated upload filename was rejected: %s", filename)
            return jsonify({'success': False, 'message': '图片保存失败'}), 500

        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, 'wb') as f:
            f.write(processed_image)
        return jsonify({
            'success': True,
            'filename': filename
        })
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as e:
        logger.warning("Rejected image upload %r: %s", file.filename, e)
        return jsonify({'success': False, 'message': '图片无效或无法处理'}), 400
    except Exception as e:
        log_exception('Image upload', e)
        return jsonify({'success': False, 'message': '图片处理失败'}), 500

if __name__ == "__main__":
    if init_db():
        app.run(
            debug=env_bool('APP_DEBUG', False) or env_bool('FLASK_DEBUG', False),
            host=os.environ.get('FLASK_RUN_HOST', '0.0.0.0'),
            port=env_int('FLASK_RUN_PORT', 5000)
        ) #  指定 host='0.0.0.0' 使 Flask 监听所有网络接口
    else:
        logger.error("数据库初始化失败，程序退出")
