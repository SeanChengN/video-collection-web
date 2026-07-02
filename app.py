import os #文件操作
import hmac
import logging
import threading
import mimetypes
import time #时间处理
from flask import Flask, render_template, request, jsonify, send_from_directory, redirect, session, url_for #Flask框架
from datetime import timedelta
from flask_compress import Compress #压缩代码
from PIL import Image #图像处理
import requests
from flask import Response, stream_with_context
from werkzeug.exceptions import RequestEntityTooLarge

from video_collection import database, movie_metadata, schema, security
from video_collection.config import env_bool, env_int
from video_collection.paths import is_path_inside
from video_collection import uploads as upload_helpers
from video_collection import videos as video_helpers
from video_collection.api_handlers import ApiHandlerDependencies, ApiHandlers
from video_collection.emby import EmbyClient
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
    return security.configured_access_token()

def access_token_required():
    return security.access_token_required()

def configured_secret_key():
    return security.configured_secret_key()

def fallback_secret_key():
    return security.fallback_secret_key(access_token_required(), logger)

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
    return security.get_csrf_token(session, CSRF_SESSION_KEY)

def request_csrf_token():
    return security.request_csrf_token(request)

def csrf_token_is_valid():
    return security.csrf_token_is_valid(session, request, CSRF_SESSION_KEY)

def csrf_required_for_request():
    return security.csrf_required_for_request(
        access_token_required(),
        request.method,
        request.endpoint,
        SAFE_HTTP_METHODS,
        {'healthz'}
    )

def auth_rate_limit_key():
    return request.remote_addr or 'unknown'

def auth_rate_limit_exceeded(key, now=None):
    return security.auth_rate_limit_exceeded(
        AUTH_RATE_LIMIT_FAILURES,
        AUTH_RATE_LIMIT_LOCK,
        AUTH_RATE_LIMIT_ATTEMPTS,
        AUTH_RATE_LIMIT_WINDOW_SECONDS,
        key,
        now
    )

def record_auth_failure(key, now=None):
    return security.record_auth_failure(
        AUTH_RATE_LIMIT_FAILURES,
        AUTH_RATE_LIMIT_LOCK,
        AUTH_RATE_LIMIT_WINDOW_SECONDS,
        key,
        now
    )

def clear_auth_failures(key):
    return security.clear_auth_failures(AUTH_RATE_LIMIT_FAILURES, AUTH_RATE_LIMIT_LOCK, key)

@app.context_processor
def inject_template_security_context():
    return {
        'csrf_token': get_csrf_token
    }

@app.after_request
def add_security_headers(response):
    return security.add_security_headers(response)

def safe_next_path(value):
    return security.safe_next_path(value)

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
DB_CONFIG = database.build_db_config()
DB_BACKUP_DIR = os.environ.get('DB_BACKUP_DIR', '/backups')
DB_BACKUP_INCLUDE_ROUTINES = env_bool('DB_BACKUP_INCLUDE_ROUTINES', False)
DB_BACKUP_SCHEDULE_ENABLED = env_bool('DB_BACKUP_SCHEDULE_ENABLED', False)
DB_BACKUP_SCHEDULE_TIME = os.environ.get('DB_BACKUP_SCHEDULE_TIME', '03:30').strip() or '03:30'
DB_BACKUP_RETENTION_COUNT = max(0, env_int('DB_BACKUP_RETENTION_COUNT', 7))

EMBY_CLIENT_NAME = 'video-collection'
EMBY_DEVICE_NAME = 'video-collection-server'
EMBY_DEVICE_ID = os.environ.get('EMBY_DEVICE_ID', 'video-collection-server')
EMBY_CLIENT_VERSION = '1.0.0'
emby_client = EmbyClient(
    environ=os.environ,
    requests_module=requests,
    client_name=EMBY_CLIENT_NAME,
    device_name=EMBY_DEVICE_NAME,
    device_id=EMBY_DEVICE_ID,
    client_version=EMBY_CLIENT_VERSION
)
EMBY_TOKEN_CACHE = emby_client.token_cache

def get_emby_server_url():
    return emby_client.get_server_url()

def get_emby_credentials():
    return emby_client.get_credentials()

def get_emby_headers(access_token=None, accept_json=True):
    return emby_client.get_headers(access_token, accept_json)

def authenticate_emby(force_refresh=False):
    return emby_client.authenticate(force_refresh)

def emby_request(method, path, params=None, headers=None, stream=False, timeout=15, force_refresh=False):
    return emby_client.request(
        method,
        path,
        params=params,
        headers=headers,
        stream=stream,
        timeout=timeout,
        force_refresh=force_refresh
    )

def get_db_connection():
    return database.get_db_connection(DB_CONFIG)

def check_database_connection():
    return database.check_database_connection(get_db_connection)

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

MOVIE_METADATA_MIGRATION = movie_metadata.MOVIE_METADATA_MIGRATION
MOVIE_IMAGES_MIGRATION = movie_metadata.MOVIE_IMAGES_MIGRATION


def table_exists(cursor, table_name):
    return movie_metadata.table_exists(cursor, table_name)


def column_exists(cursor, table_name, column_name):
    return movie_metadata.column_exists(cursor, table_name, column_name)


def index_exists(cursor, table_name, index_name):
    return movie_metadata.index_exists(cursor, table_name, index_name)


def ensure_index(cursor, table_name, index_name, create_sql):
    return movie_metadata.ensure_index(cursor, table_name, index_name, create_sql)


def migration_recorded(cursor, version):
    return movie_metadata.migration_recorded(cursor, version)


def record_schema_migration(cursor, version):
    return movie_metadata.record_schema_migration(cursor, version)


def parse_legacy_id_list(value):
    return movie_metadata.parse_legacy_id_list(value)


def parse_tag_names(value):
    return movie_metadata.parse_tag_names(value)


def parse_ratings_string(value):
    return movie_metadata.parse_ratings_string(value)


def parse_image_filenames(value):
    return movie_metadata.parse_image_filenames(value, normalize_upload_filename)


def parse_positive_int(value, default, minimum=1, maximum=None):
    return movie_metadata.parse_positive_int(value, default, minimum, maximum)


def row_value(row, key='id'):
    return movie_metadata.row_value(row, key)


def first_row_value(row):
    return movie_metadata.first_row_value(row)


def resolve_tag_ids(cursor, tag_names):
    return movie_metadata.resolve_tag_ids(cursor, tag_names)


def replace_movie_tags(cursor, movie_title, tag_ids):
    return movie_metadata.replace_movie_tags(cursor, movie_title, tag_ids)


def replace_movie_ratings(cursor, movie_title, ratings_value):
    return movie_metadata.replace_movie_ratings(cursor, movie_title, ratings_value)


def replace_movie_images(cursor, movie_title, image_filenames_value):
    return movie_metadata.replace_movie_images(cursor, movie_title, image_filenames_value, normalize_upload_filename)


def get_movie_image_filenames(cursor, movie_title):
    return movie_metadata.get_movie_image_filenames(cursor, movie_title)


def delete_unreferenced_uploaded_images(cursor, filenames):
    return movie_metadata.delete_unreferenced_uploaded_images(
        cursor,
        filenames,
        normalize_upload_filename,
        delete_uploaded_image,
        logger
    )


def sync_movie_metadata(cursor, movie_title, tag_names_value, ratings_value):
    return movie_metadata.sync_movie_metadata(cursor, movie_title, tag_names_value, ratings_value)


def hydrate_movie_rows(cursor, movies):
    return movie_metadata.hydrate_movie_rows(cursor, movies)


def resolve_rating_dimension_id(cursor, value):
    return movie_metadata.resolve_rating_dimension_id(cursor, value)


def migrate_movie_metadata_schema(conn, cursor):
    return movie_metadata.migrate_movie_metadata_schema(conn, cursor, logger)


def migrate_movie_images_schema(conn, cursor):
    return movie_metadata.migrate_movie_images_schema(conn, cursor, logger, normalize_upload_filename)


# Database initialization
def init_db():
    try:
        return schema.initialize_database(
            get_db_connection,
            logger,
            ensure_index,
            migrate_movie_metadata_schema,
            migrate_movie_images_schema
        )
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

_api_handlers = ApiHandlers(ApiHandlerDependencies(
    jsonify=jsonify,
    json_error=json_error,
    json_exception=json_exception,
    log_exception=log_exception,
    get_db_connection=get_db_connection,
    replace_movie_images=replace_movie_images,
    sync_movie_metadata=sync_movie_metadata,
    parse_image_filenames=parse_image_filenames,
    normalize_upload_filename=normalize_upload_filename,
    delete_unreferenced_uploaded_images=delete_unreferenced_uploaded_images,
    parse_tag_names=parse_tag_names,
    parse_positive_int=parse_positive_int,
    resolve_tag_ids=resolve_tag_ids,
    resolve_rating_dimension_id=resolve_rating_dimension_id,
    hydrate_movie_rows=hydrate_movie_rows,
    access_token_required=access_token_required,
    get_csrf_token=get_csrf_token,
    api_event_metadata=api_event_metadata,
    get_service_url=get_service_url,
    emby_request=emby_request,
    get_movie_image_filenames=get_movie_image_filenames,
    get_database_upgrade_diagnostics=get_database_upgrade_diagnostics,
    check_database_connection=check_database_connection,
    logger=logger,
    get_scheduled_backup_status=get_scheduled_backup_status,
    list_database_backups=list_database_backups,
    backup_feature_enabled=backup_feature_enabled,
    db_maintenance_lock=DB_MAINTENANCE_LOCK,
    run_database_backup=run_database_backup,
    database_upgrade_command_hint=database_upgrade_command_hint,
    database_upgrade_required_error=DatabaseUpgradeRequiredError,
    safe_backup_filename=safe_backup_filename,
    get_backup_file_path=get_backup_file_path,
    run_backup_restore=run_backup_restore,
    delete_database_backup_file=delete_database_backup_file,
    normalize_video_relative_path=normalize_video_relative_path,
    get_video_library_abs_path=get_video_library_abs_path,
    allowed_video_file=allowed_video_file,
    format_video_file_item=format_video_file_item,
    allowed_file=allowed_file,
    process_image=process_image,
    get_upload_file_path=get_upload_file_path,
    get_upload_folder=lambda: app.config['UPLOAD_FOLDER'],
))


def add_movie_handler(data, method='POST'):
    return _api_handlers.add_movie_handler(data, method)


def update_movie_handler(data, method='PUT'):
    return _api_handlers.update_movie_handler(data, method)


def get_ratings_dimensions_handler(data, method='GET'):
    return _api_handlers.get_ratings_dimensions_handler(data, method)


def search_movies_sql_handler(data):
    return _api_handlers.search_movies_sql_handler(data)


def search_movies_handler(data, method='GET'):
    return _api_handlers.search_movies_handler(data, method)


def get_tags_handler(data, method='GET'):
    return _api_handlers.get_tags_handler(data, method)


def get_services_config_handler(data, method='GET'):
    return _api_handlers.get_services_config_handler(data, method)


def search_emby_handler(data, method='POST'):
    return _api_handlers.search_emby_handler(data, method)


def check_title_match(title1, title2):
    return _api_handlers.check_title_match(title1, title2)


def check_duplicates_handler(data, method='POST'):
    return _api_handlers.check_duplicates_handler(data, method)


def add_tag_handler(data, method='POST'):
    return _api_handlers.add_tag_handler(data, method)


def update_tag_handler(data, method='POST'):
    return _api_handlers.update_tag_handler(data, method)


def delete_tag_handler(data, method='DELETE'):
    return _api_handlers.delete_tag_handler(data, method)


def add_rating_dimension_handler(data, method='POST'):
    return _api_handlers.add_rating_dimension_handler(data, method)


def update_rating_dimension_handler(data, method='POST'):
    return _api_handlers.update_rating_dimension_handler(data, method)


def delete_rating_dimension_handler(data, method='DELETE'):
    return _api_handlers.delete_rating_dimension_handler(data, method)


def delete_movie_handler(data, method='DELETE'):
    return _api_handlers.delete_movie_handler(data, method)


def list_db_backups_handler(data, method='GET'):
    return _api_handlers.list_db_backups_handler(data, method)


def create_db_backup_handler(data, method='POST'):
    return _api_handlers.create_db_backup_handler(data, method)


def restore_db_backup_handler(data, method='POST'):
    return _api_handlers.restore_db_backup_handler(data, method)


def delete_db_backup_handler(data, method='DELETE'):
    return _api_handlers.delete_db_backup_handler(data, method)


def list_video_files_handler(data, method='POST'):
    return _api_handlers.list_video_files_handler(data, method)


def upload_image_handler(data, method='POST'):
    return _api_handlers.upload_image_handler(data, method)

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
