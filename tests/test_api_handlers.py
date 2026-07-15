import ast
import io
import re
import socket
from dataclasses import replace
from pathlib import Path

import app as app_module
from PIL import Image
from video_collection import api_handlers_integrations as integrations_module
from video_collection.api_handlers import ApiHandlerDependencies, ApiHandlers
from video_collection.api_handlers_catalog import ApiCatalogHandlersMixin
from video_collection.api_handlers_integrations import ApiIntegrationHandlersMixin
from video_collection.api_handlers_maintenance import ApiMaintenanceHandlersMixin
from video_collection.api_handlers_media import ApiMediaHandlersMixin
from video_collection.api_handlers_movies import ApiMovieHandlersMixin


API_HANDLER_MODULES = [
    "api_handlers_movies.py",
    "api_handlers_catalog.py",
    "api_handlers_integrations.py",
    "api_handlers_maintenance.py",
    "api_handlers_media.py",
]


def unpack_response(result):
    if isinstance(result, tuple):
        response, status = result[:2]
        return response, status
    return result, result.status_code


def test_api_handlers_use_explicit_dependencies():
    assert not hasattr(app_module._api_handlers, '_namespace')
    assert isinstance(app_module._api_handlers.dependencies, ApiHandlerDependencies)
    assert app_module._api_handlers.dependencies.jsonify is app_module.jsonify
    assert isinstance(app_module._api_handlers, ApiMovieHandlersMixin)
    assert isinstance(app_module._api_handlers, ApiCatalogHandlersMixin)
    assert isinstance(app_module._api_handlers, ApiIntegrationHandlersMixin)
    assert isinstance(app_module._api_handlers, ApiMaintenanceHandlersMixin)
    assert isinstance(app_module._api_handlers, ApiMediaHandlersMixin)


def test_api_handler_modules_do_not_import_app_module():
    project_root = Path(__file__).resolve().parents[1]
    for module_name in API_HANDLER_MODULES:
        module_path = project_root / 'video_collection' / module_name
        tree = ast.parse(module_path.read_text(encoding='utf-8'))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_names = {alias.name for alias in node.names}
                assert 'app' not in imported_names
            elif isinstance(node, ast.ImportFrom):
                assert node.module != 'app'
                assert not (node.module or '').startswith('app.')


def test_backend_api_events_match_frontend_event_map():
    events_path = Path(__file__).resolve().parents[1] / 'src' / 'config' / 'events.js'
    event_pairs = re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(\d+),?', events_path.read_text(), re.MULTILINE)
    frontend_events = {int(event_id): name for name, event_id in event_pairs}
    backend_events = {
        event_id: event['name']
        for event_id, event in app_module.API_EVENTS.items()
        if 1001 <= event_id <= 1026
    }

    assert backend_events == frontend_events


class FakeEmbyLinkCursor:
    def __init__(self, item_id=None):
        self.item_id = item_id
        self.rowcount = 1

    def execute(self, sql, params=None):
        normalized = ' '.join(sql.split()).casefold()
        if normalized.startswith('update movies set emby_item_id'):
            self.item_id = params[0]

    def fetchone(self):
        return (self.item_id,) if self.item_id else None


class FakeEmbyLinkConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor
        self.commits = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self.cursor_value

    def commit(self):
        self.commits += 1


class FakeEmbyResponse:
    def __init__(self, payload, status_code=200):
        self.payload = payload
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self.closed = False

    def json(self):
        return self.payload

    def close(self):
        self.closed = True


def make_emby_link_handlers(cursor, emby_request, user_id='user-1'):
    dependencies = replace(
        app_module._api_handlers.dependencies,
        get_db_connection=lambda: FakeEmbyLinkConnection(cursor),
        emby_request=emby_request,
        get_emby_user_id=lambda: user_id
    )
    return ApiHandlers(dependencies)


def test_resolve_movie_emby_playback_uses_cached_link_without_search():
    cursor = FakeEmbyLinkCursor('cached-id')
    calls = []
    handlers = make_emby_link_handlers(cursor, lambda *args, **kwargs: calls.append((args, kwargs)))

    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(handlers.resolve_movie_emby_playback_handler({'title': 'Demo'}))

    payload = response.get_json()
    assert status == 200
    assert payload['data']['status'] == 'linked'
    assert payload['data']['playback']['id'] == 'cached-id'
    assert calls == []


def test_resolve_movie_emby_playback_auto_links_one_exact_normalized_title():
    cursor = FakeEmbyLinkCursor()
    search_response = FakeEmbyResponse({
        'Items': [{'Id': 'matched-id', 'Name': 'Demo Movie', 'Type': 'Movie'}]
    })
    handlers = make_emby_link_handlers(cursor, lambda *args, **kwargs: search_response)

    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(handlers.resolve_movie_emby_playback_handler({'title': 'demo-movie'}))

    payload = response.get_json()
    assert status == 200
    assert payload['data']['status'] == 'linked'
    assert payload['data']['playback']['id'] == 'matched-id'
    assert cursor.item_id == 'matched-id'
    assert search_response.closed is True


def test_resolve_movie_emby_refresh_keeps_valid_cached_link():
    cursor = FakeEmbyLinkCursor('cached-id')
    item_response = FakeEmbyResponse({'Id': 'cached-id', 'Name': 'Demo', 'Type': 'Movie'})
    handlers = make_emby_link_handlers(cursor, lambda *args, **kwargs: item_response)

    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(
            handlers.resolve_movie_emby_playback_handler({'title': 'Demo', 'refresh': True})
        )

    assert status == 200
    assert response.get_json()['data']['playback']['id'] == 'cached-id'
    assert cursor.item_id == 'cached-id'
    assert item_response.closed is True


def test_resolve_movie_emby_refresh_clears_missing_link_before_exact_rebind():
    cursor = FakeEmbyLinkCursor('missing-id')
    responses = iter([
        FakeEmbyResponse({}, status_code=404),
        FakeEmbyResponse({'Items': [{'Id': 'new-id', 'Name': 'Demo', 'Type': 'Movie'}]})
    ])
    handlers = make_emby_link_handlers(cursor, lambda *args, **kwargs: next(responses))

    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(
            handlers.resolve_movie_emby_playback_handler({'title': 'Demo', 'refresh': True})
        )

    assert status == 200
    assert response.get_json()['data']['playback']['id'] == 'new-id'
    assert cursor.item_id == 'new-id'


def test_link_movie_emby_verifies_movie_before_persisting():
    cursor = FakeEmbyLinkCursor()
    item_response = FakeEmbyResponse({'Id': 'movie-id', 'Name': 'Demo', 'Type': 'Movie'})
    calls = []

    def fake_emby_request(*args, **kwargs):
        calls.append((args, kwargs))
        return item_response

    handlers = make_emby_link_handlers(cursor, fake_emby_request)

    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(
            handlers.link_movie_emby_handler({'title': 'Demo', 'emby_item_id': 'movie-id'})
        )

    assert status == 200
    assert response.get_json()['data']['playback']['id'] == 'movie-id'
    assert cursor.item_id == 'movie-id'
    assert calls[0][0] == ('GET', '/emby/Users/user-1/Items/movie-id')


def test_link_movie_emby_distinguishes_missing_auth_and_service_failures():
    scenarios = (
        (404, 404, 'no longer exists'),
        (401, 502, 'authentication or permission'),
        (403, 502, 'authentication or permission'),
        (503, 502, 'temporarily unavailable'),
    )

    for emby_status, expected_status, message_fragment in scenarios:
        cursor = FakeEmbyLinkCursor()
        response = FakeEmbyResponse({}, status_code=emby_status)
        handlers = make_emby_link_handlers(cursor, lambda *args, response=response, **kwargs: response)

        with app_module.app.test_request_context('/api'):
            api_response, status = unpack_response(
                handlers.link_movie_emby_handler({'title': 'Demo', 'emby_item_id': 'movie-id'})
            )

        assert status == expected_status
        assert message_fragment in api_response.get_json()['message']
        assert cursor.item_id is None

    calls = []
    handlers = make_emby_link_handlers(
        FakeEmbyLinkCursor(),
        lambda *args, **kwargs: calls.append((args, kwargs)),
        user_id=None
    )
    with app_module.app.test_request_context('/api'):
        api_response, status = unpack_response(
            handlers.link_movie_emby_handler({'title': 'Demo', 'emby_item_id': 'movie-id'})
        )
    assert status == 502
    assert 'authentication or permission' in api_response.get_json()['message']
    assert calls == []


def test_link_movie_emby_handles_network_failure_without_persisting():
    cursor = FakeEmbyLinkCursor()

    def fail_request(*args, **kwargs):
        raise TimeoutError('Emby timeout')

    handlers = make_emby_link_handlers(cursor, fail_request)
    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(
            handlers.link_movie_emby_handler({'title': 'Demo', 'emby_item_id': 'movie-id'})
        )

    assert status == 502
    assert response.get_json()['message'] == 'Emby service is temporarily unavailable'
    assert cursor.item_id is None


class FakeExternalImageResponse:
    def __init__(self, body=b'', status_code=200, headers=None):
        self.body = body
        self.status_code = status_code
        self.headers = headers or {}
        self.closed = False

    def iter_content(self, chunk_size):
        for index in range(0, len(self.body), chunk_size):
            yield self.body[index:index + chunk_size]

    def close(self):
        self.closed = True


class FakeWtlStatusResponse:
    def __init__(self, status_code=200):
        self.status_code = status_code
        self.closed = False

    def close(self):
        self.closed = True


def make_png_bytes():
    image_bytes = io.BytesIO()
    Image.new('RGB', (4, 4), color='blue').save(image_bytes, format='PNG')
    return image_bytes.getvalue()


def allow_public_external_image_host(monkeypatch):
    monkeypatch.setattr(
        integrations_module.socket,
        'getaddrinfo',
        lambda *args, **kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('93.184.216.34', 443))
        ]
    )


def test_fetch_external_image_wrapper_rejects_unsafe_urls(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_TOKEN', '')
    calls = []
    monkeypatch.setattr(app_module.requests, 'get', lambda *args, **kwargs: calls.append((args, kwargs)))

    unsafe_urls = [
        'http://cdn.example/image.jpg',
        'https://localhost/image.jpg',
        'https://192.168.0.10/image.jpg',
    ]

    for url in unsafe_urls:
        with app_module.app.test_request_context('/api'):
            response, status = unpack_response(app_module.fetch_external_image_handler({'url': url}, 'POST'))
        assert status == 400
        assert response.get_json()['success'] is False

    assert calls == []


def test_fetch_external_image_wrapper_rejects_non_image_and_oversize(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_TOKEN', '')
    allow_public_external_image_host(monkeypatch)

    non_image = FakeExternalImageResponse(
        b'<html></html>',
        headers={'Content-Type': 'text/html', 'Content-Length': '13'}
    )
    monkeypatch.setattr(app_module.requests, 'get', lambda *args, **kwargs: non_image)
    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(app_module.fetch_external_image_handler({'url': 'https://cdn.example/page'}, 'POST'))
    assert status == 400
    assert response.get_json()['message'] == 'External URL did not return a supported image'
    assert non_image.closed is True

    oversize = FakeExternalImageResponse(
        b'',
        headers={
            'Content-Type': 'image/jpeg',
            'Content-Length': str(app_module.MAX_IMAGE_UPLOAD_BYTES + 1)
        }
    )
    monkeypatch.setattr(app_module.requests, 'get', lambda *args, **kwargs: oversize)
    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(app_module.fetch_external_image_handler({'url': 'https://cdn.example/large.jpg'}, 'POST'))
    assert status == 413
    assert response.get_json()['message'] == 'External image is too large'
    assert oversize.closed is True


def test_fetch_external_image_wrapper_returns_jpeg_data_url(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_TOKEN', '')
    allow_public_external_image_host(monkeypatch)
    body = make_png_bytes()
    external_response = FakeExternalImageResponse(
        body,
        headers={'Content-Type': 'image/png', 'Content-Length': str(len(body))}
    )
    captured = {}

    def fake_get(*args, **kwargs):
        captured['args'] = args
        captured['kwargs'] = kwargs
        return external_response

    monkeypatch.setattr(app_module.requests, 'get', fake_get)

    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(app_module.fetch_external_image_handler({'url': 'https://cdn.example/covers/demo.png'}, 'POST'))

    payload = response.get_json()
    assert status == 200
    assert payload['success'] is True
    assert payload['data_url'].startswith('data:image/jpeg;base64,')
    assert payload['filename'] == 'demo.jpg'
    assert payload['content_type'] == 'image/jpeg'
    assert captured['args'] == ('https://cdn.example/covers/demo.png',)
    assert captured['kwargs']['allow_redirects'] is False
    assert captured['kwargs']['stream'] is True
    assert external_response.closed is True


def test_check_wtl_status_wrapper_pings_homepage_and_closes_response(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_TOKEN', '')
    integrations_module.WTL_STATUS_CACHE.clear()
    external_response = FakeWtlStatusResponse(200)
    captured = {}

    def fake_get(*args, **kwargs):
        captured['args'] = args
        captured['kwargs'] = kwargs
        return external_response

    monkeypatch.setattr(app_module.requests, 'get', fake_get)

    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(app_module.check_wtl_status_handler({}, 'GET'))

    payload = response.get_json()
    assert status == 200
    assert payload['success'] is True
    assert payload['online'] is True
    assert payload['status_code'] == 200
    assert payload['cached'] is False
    assert isinstance(payload['latency_ms'], int)
    assert captured['args'] == ('https://whatslink.info/',)
    assert captured['kwargs']['timeout'] == 3
    assert captured['kwargs']['allow_redirects'] is True
    assert external_response.closed is True


def test_check_wtl_status_wrapper_caches_and_force_refreshes(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_TOKEN', '')
    integrations_module.WTL_STATUS_CACHE.clear()
    calls = []

    def fake_get(*args, **kwargs):
        response = FakeWtlStatusResponse(204)
        calls.append(response)
        return response

    monkeypatch.setattr(app_module.requests, 'get', fake_get)

    with app_module.app.test_request_context('/api'):
        first_response, _ = unpack_response(app_module.check_wtl_status_handler({}, 'GET'))
        second_response, _ = unpack_response(app_module.check_wtl_status_handler({}, 'GET'))
        forced_response, _ = unpack_response(app_module.check_wtl_status_handler({'force': True}, 'GET'))

    assert first_response.get_json()['cached'] is False
    assert second_response.get_json()['cached'] is True
    assert forced_response.get_json()['cached'] is False
    assert len(calls) == 2
    assert all(response.closed for response in calls)


def test_check_wtl_status_wrapper_reports_offline_for_5xx_and_exceptions(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_TOKEN', '')
    integrations_module.WTL_STATUS_CACHE.clear()
    server_error = FakeWtlStatusResponse(503)
    monkeypatch.setattr(app_module.requests, 'get', lambda *args, **kwargs: server_error)

    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(app_module.check_wtl_status_handler({'force': True}, 'GET'))

    payload = response.get_json()
    assert status == 200
    assert payload['success'] is True
    assert payload['online'] is False
    assert payload['status_code'] == 503
    assert server_error.closed is True

    integrations_module.WTL_STATUS_CACHE.clear()

    def raise_timeout(*args, **kwargs):
        raise TimeoutError('timeout')

    monkeypatch.setattr(app_module.requests, 'get', raise_timeout)
    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(app_module.check_wtl_status_handler({'force': True}, 'GET'))

    payload = response.get_json()
    assert status == 200
    assert payload['success'] is True
    assert payload['online'] is False
    assert payload['status_code'] is None


def test_search_movies_wrapper_rejects_invalid_recommended_filter(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_TOKEN', '')
    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(app_module.search_movies_handler({'recommended': 'bad'}, 'GET'))

    assert status == 400
    assert response.get_json()['message'] == 'Invalid recommended filter'


def test_video_files_wrapper_rejects_traversal_path():
    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(app_module.list_video_files_handler({'path': '../bad'}, 'POST'))

    assert status == 400
    assert response.get_json()['message'] == 'Invalid video directory'


def test_delete_video_file_wrapper_requires_confirmation(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, 'VIDEO_LIBRARY_ROOT', str(tmp_path))
    video_path = tmp_path / 'sample.mp4'
    video_path.write_bytes(b'video')

    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(
            app_module.delete_video_file_handler({'path': 'sample.mp4'}, 'DELETE')
        )

    assert status == 400
    assert response.get_json()['message'] == 'Video deletion requires confirmation'
    assert video_path.exists()


def test_delete_video_file_wrapper_deletes_confirmed_local_video(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, 'VIDEO_LIBRARY_ROOT', str(tmp_path))
    video_path = tmp_path / 'sample.mp4'
    video_path.write_bytes(b'video')

    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(
            app_module.delete_video_file_handler({'path': 'sample.mp4', 'confirm': True}, 'DELETE')
        )

    assert status == 200
    assert response.get_json() == {'success': True, 'path': 'sample.mp4'}
    assert not video_path.exists()


def test_delete_video_file_wrapper_rejects_missing_and_traversal_paths(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, 'VIDEO_LIBRARY_ROOT', str(tmp_path))

    with app_module.app.test_request_context('/api'):
        missing_response, missing_status = unpack_response(
            app_module.delete_video_file_handler({'path': 'missing.mp4', 'confirm': True}, 'DELETE')
        )
        traversal_response, traversal_status = unpack_response(
            app_module.delete_video_file_handler({'path': '../escape.mp4', 'confirm': True}, 'DELETE')
        )

    assert missing_status == 404
    assert missing_response.get_json()['message'] == 'Video file was not found'
    assert traversal_status == 400
    assert traversal_response.get_json()['message'] == 'Invalid video file path'


def test_search_emby_wrapper_rejects_empty_query():
    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(app_module.search_emby_handler({'query': ''}, 'POST'))

    assert status == 400
    assert response.get_json()['message'] == 'Search query is required'


def test_backup_create_wrapper_requires_enabled_backup_feature(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_TOKEN', '')
    with app_module.app.test_request_context('/api'):
        response, status = unpack_response(app_module.create_db_backup_handler({}, 'POST'))

    assert status == 403
    assert response.get_json()['success'] is False
