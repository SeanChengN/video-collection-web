import re

import app as app_module


def make_client():
    app_module.app.config.update(TESTING=True)
    return app_module.app.test_client()


def extract_csrf_token(html):
    match = re.search(r'name="csrf_token" value="([^"]+)"', html)
    assert match
    return match.group(1)


def test_auth_requires_csrf_when_access_token_is_enabled(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_TOKEN', 'expected-token')
    app_module.AUTH_RATE_LIMIT_FAILURES.clear()
    client = make_client()

    response = client.post('/auth', data={'token': 'expected-token'})

    assert response.status_code == 400
    assert response.get_json()['message'] == 'Invalid CSRF token'


def test_auth_accepts_valid_token_with_csrf(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_TOKEN', 'expected-token')
    app_module.AUTH_RATE_LIMIT_FAILURES.clear()
    client = make_client()
    csrf_token = extract_csrf_token(client.get('/auth').get_data(as_text=True))

    response = client.post('/auth', data={
        'token': 'expected-token',
        'csrf_token': csrf_token
    })

    assert response.status_code == 302
    with client.session_transaction() as session:
        assert session[app_module.AUTH_SESSION_KEY] is True


def test_auth_rate_limit_blocks_repeated_failures(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_TOKEN', 'expected-token')
    monkeypatch.setattr(app_module, 'AUTH_RATE_LIMIT_ATTEMPTS', 2)
    app_module.AUTH_RATE_LIMIT_FAILURES.clear()
    client = make_client()
    csrf_token = extract_csrf_token(client.get('/auth').get_data(as_text=True))

    for _ in range(2):
        assert client.post('/auth', data={'token': 'bad', 'csrf_token': csrf_token}).status_code == 401

    response = client.post('/auth', data={'token': 'bad', 'csrf_token': csrf_token})
    assert response.status_code == 429


def test_safe_next_path_rejects_external_or_relative_paths():
    assert app_module.safe_next_path('https://evil.example/auth') == '/'
    assert app_module.safe_next_path('//evil.example/auth') == '/'
    assert app_module.safe_next_path('relative/path') == '/'
    assert app_module.safe_next_path('/movies?page=2') == '/movies?page=2'


def test_csrf_validation_accepts_header_and_form_tokens():
    with app_module.app.test_request_context('/api', method='POST', headers={'X-CSRF-Token': 'known-token'}):
        app_module.session[app_module.CSRF_SESSION_KEY] = 'known-token'
        assert app_module.csrf_token_is_valid() is True

    with app_module.app.test_request_context('/api', method='POST', data={'csrf_token': 'known-token'}):
        app_module.session[app_module.CSRF_SESSION_KEY] = 'known-token'
        assert app_module.csrf_token_is_valid() is True

    with app_module.app.test_request_context('/api', method='POST', headers={'X-CSRF-Token': 'bad-token'}):
        app_module.session[app_module.CSRF_SESSION_KEY] = 'known-token'
        assert app_module.csrf_token_is_valid() is False


def test_api_registry_rejects_invalid_method(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_TOKEN', '')
    client = make_client()

    def handler(data, method):
        return app_module.jsonify({'success': True, 'method': method, 'data': data})

    monkeypatch.setitem(
        app_module.API_EVENTS,
        9001,
        app_module.api_event('test_event', handler, methods=('GET',))
    )

    response = client.post('/api', json={'e': 9001, 'd': {'value': 1}, 'm': 'DELETE'})

    assert response.status_code == 405
    assert response.headers['Allow'] == 'GET'


def test_api_registry_rejects_non_object_event_payload(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_TOKEN', '')
    client = make_client()

    def handler(data, method):
        return app_module.jsonify({'success': True})

    monkeypatch.setitem(
        app_module.API_EVENTS,
        9002,
        app_module.api_event('test_event', handler, methods=('POST',))
    )

    response = client.post('/api', json={'e': 9002, 'd': ['bad']})

    assert response.status_code == 400
    assert response.get_json()['message'] == 'Invalid event payload'


def test_api_requires_csrf_for_authenticated_session(monkeypatch):
    monkeypatch.setenv('APP_ACCESS_TOKEN', 'expected-token')
    client = make_client()

    def handler(data, method):
        return app_module.jsonify({'success': True})

    monkeypatch.setitem(
        app_module.API_EVENTS,
        9003,
        app_module.api_event('test_event', handler, methods=('POST',))
    )

    with client.session_transaction() as session:
        session[app_module.AUTH_SESSION_KEY] = True
        session[app_module.CSRF_SESSION_KEY] = 'known-token'

    assert client.post('/api', json={'e': 9003}).status_code == 400

    response = client.post(
        '/api',
        json={'e': 9003},
        headers={'X-CSRF-Token': 'known-token'}
    )
    assert response.status_code == 200
    assert response.get_json()['success'] is True
