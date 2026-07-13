import app as app_module
from PIL import Image
import io
import os
import stat


def assert_shared_image_mode(path):
    if os.name != 'nt':
        assert stat.S_IMODE(os.stat(path).st_mode) == 0o644


class FakeUpstream:
    def __init__(self, status_code=200, headers=None, chunks=None):
        self.status_code = status_code
        self.headers = headers or {}
        self.chunks = chunks or [b'data']
        self.closed = False
        self.ok = 200 <= status_code < 400

    def iter_content(self, chunk_size):
        for chunk in self.chunks:
            yield chunk

    def close(self):
        self.closed = True


def make_client():
    app_module.app.config.update(TESTING=True)
    return app_module.app.test_client()


def test_image_route_serves_valid_file_and_rejects_unsafe_path(monkeypatch, tmp_path):
    image_dir = tmp_path / 'images'
    image_dir.mkdir()
    image_path = image_dir / 'cover.webp'
    image_path.write_bytes(b'image-bytes')
    monkeypatch.setitem(app_module.app.config, 'UPLOAD_FOLDER', str(image_dir))
    client = make_client()

    response = client.get('/images/cover.webp')

    assert response.status_code == 200
    assert response.data == b'image-bytes'
    assert response.headers['Cache-Control'] == 'private, max-age=31536000, immutable'
    assert client.get('/images/2026/../cover.webp').status_code == 404
    assert client.get('/images/cover.webp?variant=unknown').status_code == 404


def test_image_cover_variant_is_generated_on_demand_and_cached(monkeypatch, tmp_path):
    image_dir = tmp_path / 'images'
    image_dir.mkdir()
    primary_path = image_dir / 'cover.webp'
    Image.new('RGB', (1600, 800), color='blue').save(primary_path, format='WEBP')
    chmod_calls = []
    from video_collection import uploads as uploads_module
    real_chmod = uploads_module.os.chmod

    def track_chmod(path, mode):
        chmod_calls.append((os.fspath(path), mode))
        real_chmod(path, mode)

    monkeypatch.setattr(uploads_module.os, 'chmod', track_chmod)
    monkeypatch.setitem(app_module.app.config, 'UPLOAD_FOLDER', str(image_dir))
    client = make_client()

    response = client.get('/images/cover.webp?variant=cover')

    cover_path = image_dir / 'cover.cover.webp'
    assert response.status_code == 200
    assert response.headers['Cache-Control'] == 'private, max-age=31536000, immutable'
    assert cover_path.is_file()
    assert (os.fspath(cover_path), 0o644) in chmod_calls
    assert_shared_image_mode(cover_path)
    with Image.open(cover_path) as cover:
        assert max(cover.size) == 480

    primary_response = client.get('/images/cover.webp')
    conditional_response = client.get(
        '/images/cover.webp',
        headers={'If-None-Match': primary_response.headers['ETag']}
    )
    assert conditional_response.status_code == 304


def test_emby_image_route_streams_headers_and_closes_upstream(monkeypatch):
    upstream = FakeUpstream(
        headers={
            'Content-Type': 'image/png',
            'Content-Length': '8'
        },
        chunks=[b'img-', b'data']
    )
    calls = []

    def fake_emby_request(*args, **kwargs):
        calls.append((args, kwargs))
        return upstream

    monkeypatch.setattr(app_module, 'emby_request', fake_emby_request)
    client = make_client()

    response = client.get('/emby/image/item-1?tag=abc')

    assert response.status_code == 200
    assert response.headers['Content-Type'] == 'image/png'
    assert response.headers['Content-Length'] == '8'
    assert response.data == b'img-data'
    assert upstream.closed is True
    assert calls[0][0] == ('GET', '/emby/Items/item-1/Images/Primary')
    assert calls[0][1]['params'] == {'tag': 'abc'}
    assert calls[0][1]['stream'] is True


def test_emby_stream_route_forwards_range_headers_and_closes_upstream(monkeypatch):
    upstream = FakeUpstream(
        status_code=206,
        headers={
            'Content-Type': 'video/mp4',
            'Content-Length': '4',
            'Content-Range': 'bytes 0-3/10',
            'ETag': 'etag-value'
        },
        chunks=[b'0123']
    )
    calls = []

    def fake_emby_request(*args, **kwargs):
        calls.append((args, kwargs))
        return upstream

    monkeypatch.setattr(app_module, 'emby_request', fake_emby_request)
    client = make_client()

    response = client.get('/emby/stream/item-1', headers={'Range': 'bytes=0-3'})

    assert response.status_code == 206
    assert response.headers['Content-Type'] == 'video/mp4'
    assert response.headers['Content-Length'] == '4'
    assert response.headers['Content-Range'] == 'bytes 0-3/10'
    assert response.headers['Accept-Ranges'] == 'bytes'
    assert response.headers['ETag'] == 'etag-value'
    assert response.data == b'0123'
    assert upstream.closed is True
    assert calls[0][0] == ('GET', '/emby/Videos/item-1/stream')
    assert calls[0][1]['headers'] == {'Range': 'bytes=0-3'}
    assert calls[0][1]['params'] == {'Static': 'true'}


def test_service_redirect_accepts_known_service_and_rejects_unknown_or_traversal(monkeypatch):
    monkeypatch.setenv('JACKETT_URL', 'http://jackett.local/base/')
    client = make_client()

    response = client.get('/services/jackett?path=/UI/Dashboard')

    assert response.status_code == 302
    assert response.headers['Location'] == 'http://jackett.local/base/UI/Dashboard'
    assert client.get('/services/missing?path=/UI/Dashboard').status_code == 404
    assert client.get('/services/jackett?path=../secret').status_code == 404
