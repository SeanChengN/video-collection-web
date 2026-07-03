import ast
import re
from pathlib import Path

import app as app_module
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
        if 1001 <= event_id <= 1021
    }

    assert backend_events == frontend_events


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
