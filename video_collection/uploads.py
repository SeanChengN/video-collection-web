import io
import os
import stat
import tempfile
import threading

from PIL import Image, ImageOps


ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg'}
ALLOWED_STORED_IMAGE_EXTENSIONS = {'webp', 'png', 'jpg', 'jpeg'}
IMAGE_COVER_VARIANT = 'cover'
IMAGE_PRIMARY_TARGET_HEIGHT = 720
IMAGE_COVER_MAX_DIMENSION = 480
IMAGE_COVER_SUFFIX = '.cover.webp'
IMAGE_FILE_MODE = 0o644
_COVER_GENERATION_LOCK = threading.Lock()


def allowed_file(filename, allowed_extensions=ALLOWED_EXTENSIONS):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_extensions


def allowed_stored_image_file(filename, allowed_extensions=ALLOWED_STORED_IMAGE_EXTENSIONS):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_extensions


def normalize_upload_filename(filename, allowed_extensions=ALLOWED_STORED_IMAGE_EXTENSIONS):
    filename = (filename or '').strip()
    if not filename:
        return None
    if filename.startswith('/') or '\\' in filename:
        return None
    parts = filename.split('/')
    if len(parts) not in {1, 2}:
        return None
    if any(not part or part in {'.', '..'} for part in parts):
        return None

    if len(parts) == 1:
        basename = parts[0]
        if basename != os.path.basename(basename):
            return None
        if not allowed_stored_image_file(basename, allowed_extensions):
            return None
        return basename

    year, basename = parts
    if len(year) != 4 or not year.isdigit():
        return None
    if basename != os.path.basename(basename):
        return None
    if not allowed_stored_image_file(basename, allowed_extensions):
        return None
    return f'{year}/{basename}'


def get_upload_file_path(filename, upload_folder, allowed_extensions=ALLOWED_STORED_IMAGE_EXTENSIONS):
    safe_filename = normalize_upload_filename(filename, allowed_extensions)
    if not safe_filename:
        return None

    root_path = os.path.realpath(upload_folder)
    candidate_path = os.path.realpath(os.path.join(root_path, *safe_filename.split('/')))
    try:
        if os.path.commonpath([root_path, candidate_path]) != root_path:
            return None
    except ValueError:
        return None
    return candidate_path


def get_image_variant_filename(filename, variant, allowed_extensions=ALLOWED_STORED_IMAGE_EXTENSIONS):
    safe_filename = normalize_upload_filename(filename, allowed_extensions)
    if not safe_filename or variant != IMAGE_COVER_VARIANT:
        return None

    filename_root, _ = os.path.splitext(safe_filename)
    return f'{filename_root}{IMAGE_COVER_SUFFIX}'


def _save_webp(image, target_height=None, max_dimension=None):
    output_image = image.copy()
    width, height = output_image.size
    if target_height and height > target_height:
        target_width = max(1, int(width * target_height / height))
        output_image = output_image.resize((target_width, target_height), Image.Resampling.LANCZOS)
    elif max_dimension and max(width, height) > max_dimension:
        ratio = max_dimension / max(width, height)
        output_image = output_image.resize(
            (max(1, int(width * ratio)), max(1, int(height * ratio))),
            Image.Resampling.LANCZOS
        )

    if output_image.mode not in ('RGB', 'RGBA'):
        output_image = output_image.convert('RGB')

    output = io.BytesIO()
    output_image.save(output, format='WebP', quality=85, optimize=True)
    return output.getvalue()


def process_image_variants(
    image_file,
    target_height=IMAGE_PRIMARY_TARGET_HEIGHT,
    cover_max_dimension=IMAGE_COVER_MAX_DIMENSION
):
    image_file.stream.seek(0)
    with Image.open(image_file.stream) as candidate:
        candidate.verify()

    image_file.stream.seek(0)
    with Image.open(image_file.stream) as image:
        image = ImageOps.exif_transpose(image)
        width, height = image.size
        if not width or not height:
            raise ValueError('Invalid image dimensions')

        return {
            'primary': _save_webp(image, target_height=target_height),
            IMAGE_COVER_VARIANT: _save_webp(image, max_dimension=cover_max_dimension)
        }


def delete_uploaded_image(filename, upload_folder, logger=None, allowed_extensions=ALLOWED_STORED_IMAGE_EXTENSIONS):
    file_path = get_upload_file_path(filename, upload_folder, allowed_extensions)
    if not file_path:
        if logger:
            logger.warning("Rejected unsafe image delete path: %r", filename)
        return False
    cover_filename = get_image_variant_filename(filename, IMAGE_COVER_VARIANT, allowed_extensions)
    cover_path = get_upload_file_path(cover_filename, upload_folder, allowed_extensions) if cover_filename else None
    removed = False
    for path in (file_path, cover_path):
        if path and os.path.exists(path):
            os.remove(path)
            removed = True
    return removed


def _write_bytes_atomically(file_path, content):
    directory = os.path.dirname(file_path)
    os.makedirs(directory, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(prefix='.upload-', dir=directory)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(content)
        os.replace(temporary_path, file_path)
        os.chmod(file_path, IMAGE_FILE_MODE)
    except Exception:
        try:
            os.remove(temporary_path)
        except OSError:
            pass
        raise


def normalize_uploaded_image_permissions(upload_folder, logger=None, allowed_extensions=ALLOWED_STORED_IMAGE_EXTENSIONS):
    """Restore shared read permissions for valid image files in the upload directory."""
    root_path = os.path.realpath(upload_folder)
    if not os.path.isdir(root_path):
        return 0

    normalized_count = 0
    for current_path, directory_names, filenames in os.walk(root_path, followlinks=False):
        directory_names[:] = [
            directory_name
            for directory_name in directory_names
            if not os.path.islink(os.path.join(current_path, directory_name))
        ]
        for filename in filenames:
            file_path = os.path.join(current_path, filename)
            relative_path = os.path.relpath(file_path, root_path).replace(os.sep, '/')
            if not normalize_upload_filename(relative_path, allowed_extensions):
                continue
            try:
                file_stat = os.lstat(file_path)
            except OSError as error:
                if logger:
                    logger.warning("Unable to inspect uploaded image permissions: %s", error)
                continue
            if not stat.S_ISREG(file_stat.st_mode) or stat.S_IMODE(file_stat.st_mode) == IMAGE_FILE_MODE:
                continue
            try:
                os.chmod(file_path, IMAGE_FILE_MODE)
                normalized_count += 1
            except OSError as error:
                if logger:
                    logger.warning("Unable to normalize uploaded image permissions for %r: %s", relative_path, error)
    return normalized_count


def save_image_variants(filename, variants, upload_folder, allowed_extensions=ALLOWED_STORED_IMAGE_EXTENSIONS):
    safe_filename = normalize_upload_filename(filename, allowed_extensions)
    cover_filename = get_image_variant_filename(safe_filename, IMAGE_COVER_VARIANT, allowed_extensions)
    if not safe_filename or not cover_filename:
        raise ValueError('Invalid upload filename')

    primary_content = (variants or {}).get('primary')
    cover_content = (variants or {}).get(IMAGE_COVER_VARIANT)
    if not isinstance(primary_content, bytes) or not isinstance(cover_content, bytes):
        raise ValueError('Invalid processed image variants')

    primary_path = get_upload_file_path(safe_filename, upload_folder, allowed_extensions)
    cover_path = get_upload_file_path(cover_filename, upload_folder, allowed_extensions)
    if not primary_path or not cover_path:
        raise ValueError('Invalid upload file path')

    written_paths = []
    try:
        _write_bytes_atomically(primary_path, primary_content)
        written_paths.append(primary_path)
        _write_bytes_atomically(cover_path, cover_content)
        written_paths.append(cover_path)
    except Exception:
        for path in written_paths:
            try:
                os.remove(path)
            except OSError:
                pass
        raise

    return safe_filename


def ensure_image_cover(filename, upload_folder, allowed_extensions=ALLOWED_STORED_IMAGE_EXTENSIONS):
    safe_filename = normalize_upload_filename(filename, allowed_extensions)
    cover_filename = get_image_variant_filename(safe_filename, IMAGE_COVER_VARIANT, allowed_extensions)
    if not safe_filename or not cover_filename:
        return None

    primary_path = get_upload_file_path(safe_filename, upload_folder, allowed_extensions)
    cover_path = get_upload_file_path(cover_filename, upload_folder, allowed_extensions)
    if not primary_path or not cover_path or not os.path.isfile(primary_path):
        return None
    if os.path.isfile(cover_path):
        return cover_path

    with _COVER_GENERATION_LOCK:
        if os.path.isfile(cover_path):
            return cover_path
        try:
            with Image.open(primary_path) as image:
                image = ImageOps.exif_transpose(image)
                if not image.width or not image.height:
                    return None
                cover_content = _save_webp(image, max_dimension=IMAGE_COVER_MAX_DIMENSION)
            _write_bytes_atomically(cover_path, cover_content)
        except (OSError, ValueError):
            return None
    return cover_path


def process_image(image_file, target_height=IMAGE_PRIMARY_TARGET_HEIGHT):
    return process_image_variants(image_file, target_height=target_height)['primary']
