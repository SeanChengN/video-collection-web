from video_collection.emby import EmbyClient


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.ok = 200 <= status_code < 400
        self.closed = False

    def json(self):
        return self._payload

    def close(self):
        self.closed = True


class FakeRequests:
    def __init__(self):
        self.post_calls = []
        self.request_calls = []
        self.first_request = FakeResponse(401)
        self.second_request = FakeResponse(200, {'Items': []})

    def post(self, url, json=None, headers=None, timeout=None):
        self.post_calls.append({
            'url': url,
            'json': json,
            'headers': headers,
            'timeout': timeout
        })
        token_index = len(self.post_calls)
        return FakeResponse(200, {
            'AccessToken': f'token-{token_index}',
            'User': {'Id': f'user-{token_index}'}
        })

    def request(self, method, url, params=None, headers=None, stream=False, timeout=None):
        self.request_calls.append({
            'method': method,
            'url': url,
            'params': params,
            'headers': headers,
            'stream': stream,
            'timeout': timeout
        })
        if len(self.request_calls) == 1:
            return self.first_request
        return self.second_request


def test_emby_client_refreshes_token_once_after_401():
    fake_requests = FakeRequests()
    client = EmbyClient(
        environ={
            'EMBY_SERVER_URL': 'http://emby.local/',
            'EMBY_USERNAME': 'demo',
            'EMBY_PASSWORD': 'secret',
            'EMBY_DEVICE_ID': 'device-id'
        },
        requests_module=fake_requests,
        client_name='client',
        device_name='device',
        client_version='1.2.3'
    )

    response = client.request('GET', '/emby/Items', params={'Limit': 1}, headers={'X-Test': 'yes'})

    assert response is fake_requests.second_request
    assert fake_requests.first_request.closed is True
    assert len(fake_requests.post_calls) == 2
    assert len(fake_requests.request_calls) == 2
    assert fake_requests.request_calls[0]['headers']['X-Emby-Token'] == 'token-1'
    assert fake_requests.request_calls[1]['headers']['X-Emby-Token'] == 'token-2'
    assert fake_requests.request_calls[1]['headers']['X-Test'] == 'yes'
    assert client.token_cache == {'access_token': 'token-2', 'user_id': 'user-2'}
