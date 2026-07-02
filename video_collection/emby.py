import os


class EmbyClient:
    def __init__(
        self,
        environ=None,
        requests_module=None,
        client_name='video-collection',
        device_name='video-collection-server',
        device_id=None,
        client_version='1.0.0'
    ):
        if requests_module is None:
            import requests as requests_module

        self.environ = environ or os.environ
        self.requests = requests_module
        self.client_name = client_name
        self.device_name = device_name
        self.device_id = device_id or self.environ.get('EMBY_DEVICE_ID', 'video-collection-server')
        self.client_version = client_version
        self.token_cache = {
            'access_token': None,
            'user_id': None
        }

    def get_server_url(self):
        server_url = self.environ.get('EMBY_SERVER_URL', '').strip().rstrip('/')
        if not server_url:
            raise ValueError('EMBY_SERVER_URL is not configured')
        return server_url

    def get_credentials(self):
        username = self.environ.get('EMBY_USERNAME', '').strip()
        password = self.environ.get('EMBY_PASSWORD', '')
        if not username or not password:
            raise ValueError('EMBY_USERNAME or EMBY_PASSWORD is not configured')
        return username, password

    def get_headers(self, access_token=None, accept_json=True):
        auth_value = (
            f'MediaBrowser Client="{self.client_name}", '
            f'Device="{self.device_name}", '
            f'DeviceId="{self.device_id}", '
            f'Version="{self.client_version}"'
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

    def authenticate(self, force_refresh=False):
        if self.token_cache['access_token'] and not force_refresh:
            return self.token_cache['access_token'], self.token_cache['user_id']

        server_url = self.get_server_url()
        username, password = self.get_credentials()
        response = self.requests.post(
            f'{server_url}/emby/Users/AuthenticateByName',
            json={'Username': username, 'Pw': password},
            headers=self.get_headers(),
            timeout=10
        )

        if not response.ok:
            self.token_cache['access_token'] = None
            self.token_cache['user_id'] = None
            raise RuntimeError(f'Emby authentication failed: HTTP {response.status_code}')

        auth_data = response.json()
        access_token = auth_data.get('AccessToken')
        user = auth_data.get('User') or {}
        user_id = user.get('Id') or auth_data.get('UserId')
        if not access_token:
            raise RuntimeError('Emby authentication did not return an access token')

        self.token_cache['access_token'] = access_token
        self.token_cache['user_id'] = user_id
        return access_token, user_id

    def request(self, method, path, params=None, headers=None, stream=False, timeout=15, force_refresh=False):
        server_url = self.get_server_url()
        access_token, _ = self.authenticate(force_refresh)
        request_headers = self.get_headers(access_token, accept_json=not stream)
        if headers:
            request_headers.update(headers)

        response = self.requests.request(
            method,
            f'{server_url}{path}',
            params=params,
            headers=request_headers,
            stream=stream,
            timeout=timeout
        )

        if response.status_code == 401 and not force_refresh:
            response.close()
            return self.request(
                method,
                path,
                params=params,
                headers=headers,
                stream=stream,
                timeout=timeout,
                force_refresh=True
            )

        return response
