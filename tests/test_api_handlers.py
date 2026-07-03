import ast
import io
import re
import socket
from pathlib import Path

import app as app_module
from PIL import Image
from video_collection import api_handlers_integrations as integrations_module
from video_collection.api_handlers import ApiHandlerDependencies
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
        if 1001 <= event_id <= 1022
    }

    assert backend_events == frontend_events


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
