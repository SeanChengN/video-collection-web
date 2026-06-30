import io
import tarfile

from PIL import Image

import app as app_module


def make_client():
    app_module.app.config.update(TESTING=True)
    return app_module.app.test_client()


def test_upload_filename_normalization_accepts_supported_shapes():
    assert app_module.normalize_upload_filename('cover.webp') == 'cover.webp'
    assert app_module.normalize_upload_filename('2026/cover.jpg') == '2026/cover.jpg'


def test_upload_filename_normalization_rejects_traversal_and_bad_extensions():
    assert app_module.normalize_upload_filename('../cover.webp') is None
    assert app_module.normalize_upload_filename('2026/../cover.webp') is None
    assert app_module.normalize_upload_filename('2026/cover.gif') is None
    assert app_module.normalize_upload_filename('/cover.webp') is None
    assert app_module.normalize_upload_filename('2026\\cover.webp') is None


def test_video_path_normalization_rejects_traversal():
    assert app_module.normalize_video_relative_path('movies/sample.mp4') == 'movies/sample.mp4'
    assert app_module.normalize_video_relative_path('../sample.mp4') is None
    assert app_module.normalize_video_relative_path('movies/../../sample.mp4') is None


def test_backup_filename_validation():
    assert app_module.safe_backup_filename('movies_20260630_120000.full.tar.gz')
    assert app_module.safe_backup_filename('movies.sql.gz')
    assert app_module.safe_backup_filename('../movies.sql.gz') is None
    assert app_module.safe_backup_filename('movies.zip') is None


def test_full_backup_member_validation_accepts_only_expected_files():
    image_member = tarfile.TarInfo('images/2026/cover.webp')
    image_member.type = tarfile.REGTYPE
    assert app_module.validate_full_backup_member(image_member) is True

    symlink_member = tarfile.TarInfo('images/2026/cover.webp')
    symlink_member.type = tarfile.SYMTYPE
    assert app_module.validate_full_backup_member(symlink_member) is False

    traversal_member = tarfile.TarInfo('../escape.sql.gz')
    traversal_member.type = tarfile.REGTYPE
    assert app_module.validate_full_backup_member(traversal_member) is False

    unsupported_member = tarfile.TarInfo('images/2026/cover.gif')
    unsupported_member.type = tarfile.REGTYPE
    assert app_module.validate_full_backup_member(unsupported_member) is False


def test_image_upload_creates_webp_file(monkeypatch, tmp_path):
    monkeypatch.setenv('APP_ACCESS_TOKEN', '')
    monkeypatch.setitem(app_module.app.config, 'UPLOAD_FOLDER', str(tmp_path))
    client = make_client()

    image_bytes = io.BytesIO()
    Image.new('RGB', (8, 8), color='red').save(image_bytes, format='PNG')
    image_bytes.seek(0)

    response = client.post(
        '/api',
        data={'image': (image_bytes, 'cover.png')},
        content_type='multipart/form-data'
    )

    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['filename'].endswith('.webp')
    stored_path = app_module.get_upload_file_path(payload['filename'])
    assert stored_path
    assert (tmp_path / payload['filename']).is_file()
