import re
from pathlib import Path

import app as app_module


def unpack_response(result):
    if isinstance(result, tuple):
        response, status = result[:2]
        return response, status
    return result, result.status_code


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
