import os #文件操作
import hmac
import secrets
import logging
import threading
import mimetypes
import mysql.connector #数据库连接
import time #时间处理
import uuid #UUID生成
import json #JSON处理
from flask import Flask, render_template, request, jsonify, send_from_directory, redirect, session, url_for #Flask框架
from datetime import timedelta
from contextlib import contextmanager #上下文管理器
from flask_compress import Compress #压缩代码
from PIL import Image, UnidentifiedImageError #图像处理
import requests
from urllib.parse import quote, urlsplit
from flask import Response, stream_with_context
from werkzeug.exceptions import RequestEntityTooLarge

from video_collection.config import env_bool, env_int
from video_collection.paths import is_path_inside
from video_collection import uploads as upload_helpers
from video_collection import videos as video_helpers
from video_collection.uploads import (
    ALLOWED_EXTENSIONS,
    ALLOWED_STORED_IMAGE_EXTENSIONS,
    allowed_file,
    allowed_stored_image_file,
    normalize_upload_filename,
    process_image,
)
from video_collection.videos import ALLOWED_VIDEO_EXTENSIONS
from video_collection.api_registry import (
    API_EVENTS,
    api_event,
    api_event_metadata,
    normalize_api_event_id,
    normalize_api_method,
)
from video_collection.backups import (
    BACKUP_FILENAME_PATTERN,
    SCHEDULED_BACKUP_PREFIX,
    BackupService,
    DatabaseUpgradeRequiredError,
    add_bytes_to_tar,
    database_upgrade_command_hint,
    database_upgrade_message,
    format_local_datetime,
    is_database_upgrade_error,
    parse_backup_schedule_time,
    read_process_error,
    safe_backup_filename,
    safe_tar_member_name,
)

app = Flask(__name__)
Compress(app)
logging.basicConfig(
    level=os.environ.get('LOG_LEVEL', 'INFO').upper(),
    format='%(asctime)s - %(levelname)s - %(name)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 图片上传常量
UPLOAD_FOLDER = '/images'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
VIDEO_LIBRARY_ROOT = os.environ.get('VIDEO_LIBRARY_ROOT', '/videos')
VIDEO_STREAM_CHUNK_BYTES = max(64 * 1024, env_int('VIDEO_STREAM_CHUNK_BYTES', 1024 * 1024))
MAX_IMAGE_UPLOAD_MB = max(1, env_int('MAX_IMAGE_UPLOAD_MB', 10))
MAX_IMAGE_UPLOAD_BYTES = MAX_IMAGE_UPLOAD_MB * 1024 * 1024
app.config['MAX_CONTENT_LENGTH'] = MAX_IMAGE_UPLOAD_BYTES

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

def configured_secret_key():
    return os.environ.get('SECRET_KEY', '').strip()

def fallback_secret_key():
    if access_token_required():
        logger.warning("SECRET_KEY is not configured; sessions will be invalidated on restart")
    return os.urandom(32)

AUTH_SESSION_KEY = 'app_authenticated'
CSRF_SESSION_KEY = 'csrf_token'
SAFE_HTTP_METHODS = {'GET', 'HEAD', 'OPTIONS'}
AUTH_RATE_LIMIT_FAILURES = {}
AUTH_RATE_LIMIT_LOCK = threading.Lock()
AUTH_RATE_LIMIT_ATTEMPTS = max(1, env_int('AUTH_RATE_LIMIT_ATTEMPTS', 10))
AUTH_RATE_LIMIT_WINDOW_SECONDS = max(30, env_int('AUTH_RATE_LIMIT_WINDOW_SECONDS', 300))

app.secret_key = configured_secret_key() or fallback_secret_key()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE=os.environ.get('SESSION_COOKIE_SAMESITE', 'Lax'),
    SESSION_COOKIE_SECURE=env_bool('SESSION_COOKIE_SECURE', False),
    PERMANENT_SESSION_LIFETIME=timedelta(seconds=max(300, env_int('SESSION_LIFETIME_SECONDS', 86400)))
)

def is_authenticated_session():
    return session.get(AUTH_SESSION_KEY) is True

def get_csrf_token():
    token = session.get(CSRF_SESSION_KEY)
    if not token:
        token = secrets.token_urlsafe(32)
        session[CSRF_SESSION_KEY] = token
    return token

def request_csrf_token():
    return request.headers.get('X-CSRF-Token', '') or request.form.get('csrf_token', '')

def csrf_token_is_valid():
    expected = session.get(CSRF_SESSION_KEY, '')
    provided = request_csrf_token()
    return bool(expected and provided and hmac.compare_digest(provided, expected))

def csrf_required_for_request():
    return (
        access_token_required()
        and request.method not in SAFE_HTTP_METHODS
        and request.endpoint not in {'healthz'}
    )

def auth_rate_limit_key():
    return request.remote_addr or 'unknown'

def auth_rate_limit_exceeded(key, now=None):
    now = now or time.monotonic()
    cutoff = now - AUTH_RATE_LIMIT_WINDOW_SECONDS
    with AUTH_RATE_LIMIT_LOCK:
        failures = [stamp for stamp in AUTH_RATE_LIMIT_FAILURES.get(key, []) if stamp >= cutoff]
        AUTH_RATE_LIMIT_FAILURES[key] = failures
        return len(failures) >= AUTH_RATE_LIMIT_ATTEMPTS

def record_auth_failure(key, now=None):
    now = now or time.monotonic()
    cutoff = now - AUTH_RATE_LIMIT_WINDOW_SECONDS
    with AUTH_RATE_LIMIT_LOCK:
        failures = [stamp for stamp in AUTH_RATE_LIMIT_FAILURES.get(key, []) if stamp >= cutoff]
        failures.append(now)
        AUTH_RATE_LIMIT_FAILURES[key] = failures

def clear_auth_failures(key):
    with AUTH_RATE_LIMIT_LOCK:
        AUTH_RATE_LIMIT_FAILURES.pop(key, None)

@app.context_processor
def inject_template_security_context():
    return {
        'csrf_token': get_csrf_token
    }

@app.after_request
def add_security_headers(response):
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
    response.headers.setdefault('Referrer-Policy', 'same-origin')
    response.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    return response

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

@app.before_request
def enforce_csrf_protection():
    if not csrf_required_for_request():
        return None
    if csrf_token_is_valid():
        return None
    return json_error('Invalid CSRF token', 400)

@app.route('/auth', methods=['GET', 'POST'])
def auth():
    next_path = safe_next_path(request.values.get('next', '/'))
    if not access_token_required():
        return redirect(next_path)
    if is_authenticated_session():
        return redirect(next_path)

    error = False
    rate_limited = False
    if request.method == 'POST':
        client_key = auth_rate_limit_key()
        if auth_rate_limit_exceeded(client_key):
            rate_limited = True
            return render_template(
                'auth.html',
                error=True,
                rate_limited=rate_limited,
                next_path=next_path
            ), 429

        provided_token = request.form.get('token', '').strip()
        if provided_token and hmac.compare_digest(provided_token, configured_access_token()):
            session[AUTH_SESSION_KEY] = True
            session.permanent = False
            clear_auth_failures(client_key)
            return redirect(next_path)
        session.pop(AUTH_SESSION_KEY, None)
        record_auth_failure(client_key)
        error = True

    return render_template(
        'auth.html',
        error=error,
        rate_limited=rate_limited,
        next_path=next_path
    ), 401 if error else 200

@app.errorhandler(RequestEntityTooLarge)
def handle_request_too_large(error):
    return json_error(f'Uploaded file is too large. Max size is {MAX_IMAGE_UPLOAD_MB} MB.', 413)

def get_upload_file_path(filename):
    return upload_helpers.get_upload_file_path(
        filename,
        app.config['UPLOAD_FOLDER'],
        ALLOWED_STORED_IMAGE_EXTENSIONS
    )

def delete_uploaded_image(filename):
    return upload_helpers.delete_uploaded_image(
        filename,
        app.config['UPLOAD_FOLDER'],
        logger,
        ALLOWED_STORED_IMAGE_EXTENSIONS
    )

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
DB_BACKUP_SCHEDULE_ENABLED = env_bool('DB_BACKUP_SCHEDULE_ENABLED', False)
DB_BACKUP_SCHEDULE_TIME = os.environ.get('DB_BACKUP_SCHEDULE_TIME', '03:30').strip() or '03:30'
DB_BACKUP_RETENTION_COUNT = max(0, env_int('DB_BACKUP_RETENTION_COUNT', 7))

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

backup_service = BackupService(
    db_config_getter=lambda: DB_CONFIG,
    backup_dir_getter=lambda: DB_BACKUP_DIR,
    upload_folder_getter=lambda: app.config['UPLOAD_FOLDER'],
    db_connection_factory=get_db_connection,
    logger=logger,
    image_filename_normalizer=normalize_upload_filename,
    include_routines_getter=lambda: DB_BACKUP_INCLUDE_ROUTINES,
    schedule_enabled_getter=lambda: DB_BACKUP_SCHEDULE_ENABLED,
    schedule_time_getter=lambda: DB_BACKUP_SCHEDULE_TIME,
    retention_count_getter=lambda: DB_BACKUP_RETENTION_COUNT
)
DB_MAINTENANCE_LOCK = backup_service.maintenance_lock
SCHEDULED_BACKUP_STATE_LOCK = backup_service.state_lock
SCHEDULED_BACKUP_THREAD_LOCK = backup_service.thread_lock
SCHEDULED_BACKUP_THREAD_STARTED = backup_service.thread_started
SCHEDULED_BACKUP_STATE = backup_service.state


def backup_feature_enabled():
    return access_token_required() and is_authenticated_session()


def sanitized_database_name():
    return backup_service.sanitized_database_name()


def get_backup_file_path(filename, must_exist=False):
    return backup_service.get_backup_file_path(filename, must_exist)


def backup_command_env():
    return backup_service.backup_command_env()


def get_database_upgrade_diagnostics():
    return backup_service.get_database_upgrade_diagnostics()


def build_database_dump_command():
    return backup_service.build_database_dump_command()


def classify_backup_filename(filename):
    return backup_service.classify_backup_filename(filename)


def iter_safe_image_files():
    return backup_service.iter_safe_image_files()


def run_database_dump_to_file(target_path):
    return backup_service.run_database_dump_to_file(target_path)


def run_database_backup(prefix=''):
    return backup_service.run_database_backup(prefix)


def run_database_restore_from_path(backup_path):
    return backup_service.run_database_restore_from_path(backup_path)


def validate_full_backup_member(member):
    return backup_service.validate_full_backup_member(member)


def extract_full_backup_to_temp(backup_path):
    return backup_service.extract_full_backup_to_temp(backup_path)


def validate_extracted_images(images_path):
    return backup_service.validate_extracted_images(images_path)


def clear_directory_contents(directory_path):
    return backup_service.clear_directory_contents(directory_path)


def copy_directory_contents(source_dir, target_dir):
    return backup_service.copy_directory_contents(source_dir, target_dir)


def restore_images_snapshot(images_path):
    return backup_service.restore_images_snapshot(images_path)


def run_full_backup_restore(filename):
    return backup_service.run_full_backup_restore(filename)


def run_backup_restore(filename):
    return backup_service.run_backup_restore(filename)


def format_backup_file(filename, path):
    return backup_service.format_backup_file(filename, path)


def list_database_backups():
    return backup_service.list_database_backups()


def delete_database_backup_file(filename):
    return backup_service.delete_database_backup_file(filename)


def scheduled_backup_time_parts():
    return backup_service.scheduled_backup_time_parts()


def scheduled_backup_is_enabled():
    return backup_service.scheduled_backup_is_enabled()


def calculate_next_scheduled_backup_time(now=None):
    return backup_service.calculate_next_scheduled_backup_time(now)


def update_scheduled_backup_state(**updates):
    return backup_service.update_scheduled_backup_state(**updates)


def get_scheduled_backup_status():
    return backup_service.get_scheduled_backup_status()


def list_scheduled_backup_files():
    return backup_service.list_scheduled_backup_files()


def cleanup_scheduled_backups():
    return backup_service.cleanup_scheduled_backups()


def run_scheduled_backup_once():
    return backup_service.run_scheduled_backup_once()


def scheduled_backup_worker():
    return backup_service.scheduled_backup_worker()


def start_scheduled_backup_thread(debug_enabled=False):
    global SCHEDULED_BACKUP_THREAD_STARTED
    backup_service.start_scheduled_backup_thread(debug_enabled)
    SCHEDULED_BACKUP_THREAD_STARTED = backup_service.thread_started

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
    ratings_display_by_title = {}
    for row in cursor.fetchall():
        title = row['movie_title']
        dimension_id = int(row['dimension_id'])
        rating = int(row['rating'])
        ratings_by_title.setdefault(title, []).append((dimension_id, rating))
        ratings_display_by_title.setdefault(title, {})[row['dimension_name']] = rating

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
        movie['ratings'] = ','.join(f"{dimension_id}:{rating}" for dimension_id, rating in ratings)
        movie['ratings_display'] = ratings_display_by_title.get(title, {})

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
    return video_helpers.normalize_video_relative_path(path_value)

def get_video_library_abs_path(relative_path=''):
    return video_helpers.get_video_library_abs_path(relative_path, VIDEO_LIBRARY_ROOT)

def allowed_video_file(filename):
    return video_helpers.allowed_video_file(filename, ALLOWED_VIDEO_EXTENSIONS)

def parse_byte_range(range_header, file_size):
    return video_helpers.parse_byte_range(range_header, file_size)

def stream_file_slice(abs_path, start, end):
    return video_helpers.stream_file_slice(abs_path, start, end, VIDEO_STREAM_CHUNK_BYTES)

def format_video_file_item(directory_relative_path, filename):
    return video_helpers.format_video_file_item(directory_relative_path, filename, VIDEO_LIBRARY_ROOT)

@app.route('/videos/<path:filename>')
def serve_video(filename):
    safe_relative = normalize_video_relative_path(filename)
    if not safe_relative or not allowed_video_file(safe_relative):
        return Response(status=404)

    abs_path = get_video_library_abs_path(safe_relative)
    if not abs_path or not os.path.isfile(abs_path):
        return Response(status=404)

    file_size = os.path.getsize(abs_path)
    content_type = mimetypes.guess_type(abs_path)[0] or 'application/octet-stream'
    range_header = request.headers.get('Range')
    byte_range = parse_byte_range(range_header, file_size)
    common_headers = {
        'Accept-Ranges': 'bytes',
        'Content-Type': content_type
    }

    if range_header and byte_range is None:
        return Response(
            status=416,
            headers={
                **common_headers,
                'Content-Range': f'bytes */{file_size}',
                'Content-Length': '0'
            }
        )

    if byte_range:
        start, end = byte_range
        status_code = 206
        response_headers = {
            **common_headers,
            'Content-Range': f'bytes {start}-{end}/{file_size}',
            'Content-Length': str(end - start + 1)
        }
    else:
        start, end = 0, max(file_size - 1, 0)
        status_code = 200
        response_headers = {
            **common_headers,
            'Content-Length': str(file_size)
        }

    if request.method == 'HEAD' or file_size == 0:
        return Response(status=status_code, headers=response_headers)

    return Response(
        stream_with_context(stream_file_slice(abs_path, start, end)),
        status=status_code,
        headers=response_headers,
        direct_passthrough=True
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
            return upload_image_handler(None, 'POST')
        
        # JSON请求
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            return json_error('Invalid API payload', 400)

        event_id = normalize_api_event_id(payload.get('e'))
        data = payload.get('d', {})
        if data is None:
            data = {}
        if not isinstance(data, dict):
            return json_error('Invalid event payload', 400)

        method = normalize_api_method(payload.get('m', 'POST')) # 获取原始method
        event = API_EVENTS.get(event_id)
        if not event:
            return jsonify({"success": False, "message": "无效的事件ID"}), 400
        if method not in event['methods']:
            response = jsonify({
                "success": False,
                "message": f"Method {method} is not allowed for event {event_id}"
            })
            response.headers['Allow'] = ', '.join(sorted(event['methods']))
            return response, 405
            
        return event['handler'](data, method) # 传递method给处理器
        
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
    recommended_raw = data.get('recommended')
    recommended_filter = '' if recommended_raw is None else str(recommended_raw).strip()
    selected_tag_names = parse_tag_names(data.get('tags', ''))
    page = parse_positive_int(data.get('page'), 1, 1)
    per_page = parse_positive_int(data.get('per_page'), 10, 1, 100)

    if recommended_filter and recommended_filter not in ('0', '1'):
        return json_error('Invalid recommended filter', 400)

    with get_db_connection() as conn:
        cursor = conn.cursor(dictionary=True)
        where_clauses = []
        params = []

        if search_term:
            where_clauses.append("(m.title LIKE %s OR m.review LIKE %s)")
            params.extend([f'%{search_term}%', f'%{search_term}%'])

        if recommended_filter:
            where_clauses.append("m.recommended = %s")
            params.append(1 if recommended_filter == '1' else 0)

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
                COALESCE((
                    SELECT mr_filter.rating
                    FROM movie_ratings mr_filter
                    WHERE mr_filter.movie_title = m.title
                      AND mr_filter.dimension_id = %s
                    LIMIT 1
                ), 3) >= %s
            """)
            params.extend([rating_dimension_id, min_rating])
        elif min_rating is not None:
            where_clauses.append("""
                NOT EXISTS (
                    SELECT 1
                    FROM ratings_dimensions rd_filter
                    LEFT JOIN movie_ratings mr_low
                      ON mr_low.dimension_id = rd_filter.id
                     AND mr_low.movie_title = m.title
                    WHERE COALESCE(mr_low.rating, 3) < %s
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
                'csrf_token': get_csrf_token(),
                'api_events': api_event_metadata(),
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
                "scheduled_backup": get_scheduled_backup_status(),
                "backups": [],
                **upgrade_diagnostics
            })

        return jsonify({
            "success": True,
            "maintenance_enabled": True,
            "database_status": database_status,
            "scheduled_backup": get_scheduled_backup_status(),
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

API_EVENTS.update({
    1001: api_event('get_services_config', get_services_config_handler, methods=('GET', 'POST')),
    1002: api_event('get_tags', get_tags_handler, methods=('GET', 'POST')),
    1003: api_event('get_ratings_dimensions', get_ratings_dimensions_handler, methods=('GET', 'POST')),
    1004: api_event('add_tag', add_tag_handler, methods=('POST',)),
    1005: api_event('update_tag', update_tag_handler, methods=('POST', 'PUT')),
    1006: api_event('add_rating_dimension', add_rating_dimension_handler, methods=('POST',)),
    1007: api_event('update_rating_dimension', update_rating_dimension_handler, methods=('POST', 'PUT')),
    1008: api_event('add_movie', add_movie_handler, methods=('POST',)),
    1009: api_event('check_duplicates', check_duplicates_handler, methods=('POST',)),
    1010: api_event('upload_image', upload_image_handler, methods=('POST',)),
    1011: api_event('search_movies', search_movies_handler, methods=('GET', 'POST')),
    1012: api_event('update_movie', update_movie_handler, methods=('PUT', 'POST')),
    1013: api_event('delete_movie', delete_movie_handler, methods=('DELETE', 'POST')),
    1014: api_event('search_emby', search_emby_handler, methods=('POST',)),
    1015: api_event('list_video_files', list_video_files_handler, methods=('POST',)),
    1016: api_event('delete_tag', delete_tag_handler, methods=('DELETE', 'POST')),
    1017: api_event('delete_rating_dimension', delete_rating_dimension_handler, methods=('DELETE', 'POST')),
    1018: api_event('list_db_backups', list_db_backups_handler, methods=('GET', 'POST')),
    1019: api_event('create_db_backup', create_db_backup_handler, methods=('POST',)),
    1020: api_event('restore_db_backup', restore_db_backup_handler, methods=('POST',)),
    1021: api_event('delete_db_backup', delete_db_backup_handler, methods=('DELETE', 'POST'))
})

APP_INITIALIZATION_LOCK = threading.Lock()
APP_INITIALIZED = False

def debug_enabled():
    return env_bool('APP_DEBUG', False) or env_bool('FLASK_DEBUG', False)

def initialize_application(startup_debug_enabled=None):
    global APP_INITIALIZED
    with APP_INITIALIZATION_LOCK:
        if APP_INITIALIZED:
            return True
        startup_debug_enabled = debug_enabled() if startup_debug_enabled is None else startup_debug_enabled
        if not init_db():
            logger.error("Database initialization failed; application startup aborted")
            return False
        start_scheduled_backup_thread(startup_debug_enabled)
        APP_INITIALIZED = True
        return True

if __name__ == "__main__":
    startup_debug_enabled = debug_enabled()
    if initialize_application(startup_debug_enabled):
        app.run(
            debug=startup_debug_enabled,
            host=os.environ.get('FLASK_RUN_HOST', '0.0.0.0'),
            port=env_int('FLASK_RUN_PORT', 5000)
        ) #  指定 host='0.0.0.0' 使 Flask 监听所有网络接口
    else:
        logger.error("数据库初始化失败，程序退出")
