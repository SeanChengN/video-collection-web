import io
import os
import stat
import tarfile
import ast
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

import app as app_module
import video_collection.backups as backups_module
import video_collection.videos as video_helpers
import video_collection.uploads as uploads_module
from video_collection.backup_archive_ops import BackupArchiveOpsMixin
from video_collection.backup_database_ops import BackupDatabaseOpsMixin
from video_collection.backup_scheduler import BackupSchedulerMixin


BACKUP_MODULES = [
    "backup_validation.py",
    "backup_database_ops.py",
    "backup_archive_ops.py",
    "backup_scheduler.py",
]


def make_client():
    app_module.app.config.update(TESTING=True)
    return app_module.app.test_client()


def assert_shared_image_mode(path):
    if os.name != 'nt':
        assert stat.S_IMODE(os.stat(path).st_mode) == 0o644


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


def test_video_file_deletion_rejects_non_video_and_directory_paths(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, 'VIDEO_LIBRARY_ROOT', str(tmp_path))
    (tmp_path / 'notes.txt').write_text('not a video', encoding='utf-8')
    (tmp_path / 'folder.mp4').mkdir()

    for path in ('notes.txt', 'folder.mp4', '../escape.mp4', ''):
        try:
            app_module.delete_video_file(path)
        except ValueError:
            pass
        else:
            raise AssertionError(f'Expected ValueError for {path!r}')


def test_video_file_deletion_rejects_symbolic_links(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, 'VIDEO_LIBRARY_ROOT', str(tmp_path))
    video_path = tmp_path / 'sample.mp4'
    video_path.write_bytes(b'video')
    monkeypatch.setattr(video_helpers, 'get_video_library_abs_path', lambda *args: str(video_path))
    monkeypatch.setattr(
        video_helpers.os,
        'lstat',
        lambda path: SimpleNamespace(st_mode=stat.S_IFLNK)
    )

    try:
        app_module.delete_video_file('sample.mp4')
    except ValueError:
        pass
    else:
        raise AssertionError('Expected symbolic link deletion to be rejected')

    assert video_path.exists()


def test_video_file_deletion_removes_only_the_empty_direct_parent(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, 'VIDEO_LIBRARY_ROOT', str(tmp_path))
    parent_dir = tmp_path / 'collection'
    video_dir = parent_dir / 'movie'
    video_dir.mkdir(parents=True)
    (video_dir / 'sample.mp4').write_bytes(b'video')

    result = app_module.delete_video_file('collection/movie/sample.mp4')

    assert result == {
        'path': 'collection/movie/sample.mp4',
        'removed_directory': 'collection/movie',
        'next_path': 'collection'
    }
    assert not video_dir.exists()
    assert parent_dir.exists()


def test_video_file_deletion_keeps_nonempty_parent_directory(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, 'VIDEO_LIBRARY_ROOT', str(tmp_path))
    video_dir = tmp_path / 'movie'
    video_dir.mkdir()
    (video_dir / 'sample.mp4').write_bytes(b'video')
    (video_dir / '.keep').write_text('keep', encoding='utf-8')
    (video_dir / 'extras').mkdir()

    result = app_module.delete_video_file('movie/sample.mp4')

    assert result == {
        'path': 'movie/sample.mp4',
        'removed_directory': None,
        'next_path': 'movie'
    }
    assert video_dir.exists()
    assert (video_dir / '.keep').exists()
    assert (video_dir / 'extras').is_dir()


def test_video_route_serves_full_file_with_range_support(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, 'VIDEO_LIBRARY_ROOT', str(tmp_path))
    video_dir = tmp_path / 'movies'
    video_dir.mkdir()
    video_path = video_dir / 'sample.mp4'
    video_path.write_bytes(b'0123456789')
    client = make_client()

    response = client.get('/videos/movies/sample.mp4')

    assert response.status_code == 200
    assert response.headers['Accept-Ranges'] == 'bytes'
    assert response.headers['Content-Length'] == '10'
    assert response.data == b'0123456789'


def test_video_route_serves_partial_byte_range(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, 'VIDEO_LIBRARY_ROOT', str(tmp_path))
    video_dir = tmp_path / 'movies'
    video_dir.mkdir()
    video_path = video_dir / 'sample.mp4'
    video_path.write_bytes(b'0123456789')
    client = make_client()

    response = client.get('/videos/movies/sample.mp4', headers={'Range': 'bytes=2-5'})

    assert response.status_code == 206
    assert response.headers['Accept-Ranges'] == 'bytes'
    assert response.headers['Content-Range'] == 'bytes 2-5/10'
    assert response.headers['Content-Length'] == '4'
    assert response.data == b'2345'

    open_ended_response = client.get('/videos/movies/sample.mp4', headers={'Range': 'bytes=7-'})
    assert open_ended_response.status_code == 206
    assert open_ended_response.headers['Content-Range'] == 'bytes 7-9/10'
    assert open_ended_response.data == b'789'

    suffix_response = client.get('/videos/movies/sample.mp4', headers={'Range': 'bytes=-3'})
    assert suffix_response.status_code == 206
    assert suffix_response.headers['Content-Range'] == 'bytes 7-9/10'
    assert suffix_response.data == b'789'


def test_video_route_rejects_invalid_range(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, 'VIDEO_LIBRARY_ROOT', str(tmp_path))
    video_dir = tmp_path / 'movies'
    video_dir.mkdir()
    video_path = video_dir / 'sample.mp4'
    video_path.write_bytes(b'0123456789')
    client = make_client()

    response = client.get('/videos/movies/sample.mp4', headers={'Range': 'bytes=20-30'})

    assert response.status_code == 416
    assert response.headers['Accept-Ranges'] == 'bytes'
    assert response.headers['Content-Range'] == 'bytes */10'


def test_video_route_rejects_traversal(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, 'VIDEO_LIBRARY_ROOT', str(tmp_path / 'videos'))
    outside_file = tmp_path / 'escape.mp4'
    outside_file.write_bytes(b'escape')
    client = make_client()

    response = client.get('/videos/../escape.mp4')

    assert response.status_code == 404


def test_backup_filename_validation():
    assert app_module.safe_backup_filename('movies_20260630_120000.full.tar.gz')
    assert app_module.safe_backup_filename('movies.sql.gz')
    assert app_module.safe_backup_filename('../movies.sql.gz') is None
    assert app_module.safe_backup_filename('movies.zip') is None


def test_backup_service_keeps_public_entrypoint_and_mixins():
    assert isinstance(app_module.backup_service, BackupArchiveOpsMixin)
    assert isinstance(app_module.backup_service, BackupDatabaseOpsMixin)
    assert isinstance(app_module.backup_service, BackupSchedulerMixin)
    assert backups_module.safe_backup_filename('movies.sql.gz') == 'movies.sql.gz'
    assert backups_module.parse_backup_schedule_time('03:30') == (3, 30)
    assert backups_module.classify_backup_filename('movies.sql.gz')['type'] == 'database'


def test_backup_modules_do_not_import_app_module():
    project_root = Path(__file__).resolve().parents[1]
    for module_name in BACKUP_MODULES:
        module_path = project_root / 'video_collection' / module_name
        tree = ast.parse(module_path.read_text(encoding='utf-8'))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_names = {alias.name for alias in node.names}
                assert 'app' not in imported_names
            elif isinstance(node, ast.ImportFrom):
                assert node.module != 'app'
                assert not (node.module or '').startswith('app.')


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
    chmod_calls = []
    real_chmod = uploads_module.os.chmod

    def track_chmod(path, mode):
        chmod_calls.append((os.fspath(path), mode))
        real_chmod(path, mode)

    monkeypatch.setattr(uploads_module.os, 'chmod', track_chmod)
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
    cover_filename = app_module.get_image_variant_filename(payload['filename'], 'cover')
    assert cover_filename
    assert (tmp_path / cover_filename).is_file()
    for image_path in (tmp_path / payload['filename'], tmp_path / cover_filename):
        assert (os.fspath(image_path), 0o644) in chmod_calls
        assert_shared_image_mode(image_path)


def test_image_upload_preserves_valid_capture_timestamp_in_filename(monkeypatch, tmp_path):
    monkeypatch.setenv('APP_ACCESS_TOKEN', '')
    monkeypatch.setitem(app_module.app.config, 'UPLOAD_FOLDER', str(tmp_path))
    client = make_client()

    image_bytes = io.BytesIO()
    Image.new('RGB', (8, 8), color='blue').save(image_bytes, format='PNG')
    image_bytes.seek(0)

    response = client.post(
        '/api',
        data={
            'image': (image_bytes, 'capture.png'),
            'capture_timestamp': '83.45'
        },
        content_type='multipart/form-data'
    )

    payload = response.get_json()
    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['filename'].endswith('__at-83.45s.webp')


def test_image_upload_rejects_invalid_capture_timestamp(monkeypatch, tmp_path):
    monkeypatch.setenv('APP_ACCESS_TOKEN', '')
    monkeypatch.setitem(app_module.app.config, 'UPLOAD_FOLDER', str(tmp_path))
    client = make_client()

    image_bytes = io.BytesIO()
    Image.new('RGB', (8, 8), color='green').save(image_bytes, format='PNG')
    image_bytes.seek(0)

    response = client.post(
        '/api',
        data={
            'image': (image_bytes, 'capture.png'),
            'capture_timestamp': '-1'
        },
        content_type='multipart/form-data'
    )

    assert response.status_code == 400
    assert response.get_json()['message'] == 'Invalid capture timestamp'


def test_image_variants_limit_cover_size_and_cleanup_together(monkeypatch, tmp_path):
    image_bytes = io.BytesIO()
    Image.new('RGB', (1600, 800), color='red').save(image_bytes, format='PNG')
    image_bytes.seek(0)

    chmod_calls = []
    real_chmod = uploads_module.os.chmod

    def track_chmod(path, mode):
        chmod_calls.append((os.fspath(path), mode))
        real_chmod(path, mode)

    monkeypatch.setattr(uploads_module.os, 'chmod', track_chmod)

    variants = uploads_module.process_image_variants(SimpleNamespace(stream=image_bytes))
    uploads_module.save_image_variants('2026/cover.webp', variants, str(tmp_path))
    cover_filename = uploads_module.get_image_variant_filename('2026/cover.webp', 'cover')
    assert cover_filename == '2026/cover.cover.webp'

    with Image.open(tmp_path / cover_filename) as cover:
        assert max(cover.size) == 480

    for image_path in (tmp_path / '2026/cover.webp', tmp_path / cover_filename):
        assert (os.fspath(image_path), 0o644) in chmod_calls
        assert_shared_image_mode(image_path)

    assert uploads_module.delete_uploaded_image('2026/cover.webp', str(tmp_path)) is True
    assert not (tmp_path / '2026/cover.webp').exists()
    assert not (tmp_path / cover_filename).exists()


def test_normalize_uploaded_image_permissions_repairs_only_valid_regular_images(monkeypatch, tmp_path):
    primary_path = tmp_path / 'cover.webp'
    primary_path.write_bytes(b'primary')
    year_path = tmp_path / '2026'
    year_path.mkdir()
    cover_path = year_path / 'cover.cover.webp'
    cover_path.write_bytes(b'cover')
    non_image_path = tmp_path / 'notes.txt'
    non_image_path.write_text('notes', encoding='utf-8')
    nested_path = year_path / 'nested'
    nested_path.mkdir()
    unsupported_path = nested_path / 'skip.webp'
    unsupported_path.write_bytes(b'skip')
    symlink_like_path = tmp_path / 'linked.webp'
    symlink_like_path.write_bytes(b'linked')
    for path in (primary_path, cover_path, non_image_path, unsupported_path, symlink_like_path):
        os.chmod(path, 0o600)

    real_lstat = uploads_module.os.lstat

    def lstat_with_linked_file(path):
        if os.fspath(path) == os.fspath(symlink_like_path):
            return SimpleNamespace(st_mode=stat.S_IFLNK)
        return real_lstat(path)

    monkeypatch.setattr(uploads_module.os, 'lstat', lstat_with_linked_file)

    assert uploads_module.normalize_uploaded_image_permissions(str(tmp_path)) == 2
    assert_shared_image_mode(primary_path)
    assert_shared_image_mode(cover_path)
    assert stat.S_IMODE(os.stat(non_image_path).st_mode) != 0o644
    assert stat.S_IMODE(os.stat(unsupported_path).st_mode) != 0o644
    assert stat.S_IMODE(os.stat(symlink_like_path).st_mode) != 0o644


def test_normalize_uploaded_image_permissions_logs_chmod_failures(monkeypatch, tmp_path, caplog):
    failing_path = tmp_path / 'failing.webp'
    good_path = tmp_path / 'good.webp'
    for path in (failing_path, good_path):
        path.write_bytes(b'image')
        os.chmod(path, 0o600)

    real_chmod = uploads_module.os.chmod

    def chmod_with_failure(path, mode):
        if os.fspath(path) == os.fspath(failing_path):
            raise OSError('permission denied')
        real_chmod(path, mode)

    monkeypatch.setattr(uploads_module.os, 'chmod', chmod_with_failure)

    assert uploads_module.normalize_uploaded_image_permissions(str(tmp_path), app_module.logger) == 1
    assert stat.S_IMODE(os.stat(failing_path).st_mode) != 0o644
    assert_shared_image_mode(good_path)
    assert 'Unable to normalize uploaded image permissions' in caplog.text


def test_initialize_application_normalizes_uploaded_image_permissions(monkeypatch):
    monkeypatch.setattr(app_module, 'APP_INITIALIZED', False)
    monkeypatch.setattr(app_module, 'init_db', lambda: True)
    monkeypatch.setattr(app_module, 'normalize_upload_image_permissions', lambda: 2)
    monkeypatch.setattr(app_module, 'start_scheduled_backup_thread', lambda enabled: None)

    assert app_module.initialize_application(startup_debug_enabled=False) is True
