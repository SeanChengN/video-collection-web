import io
import os

from PIL import Image, ImageOps


ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg'}
ALLOWED_STORED_IMAGE_EXTENSIONS = {'webp', 'png', 'jpg', 'jpeg'}


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


def delete_uploaded_image(filename, upload_folder, logger=None, allowed_extensions=ALLOWED_STORED_IMAGE_EXTENSIONS):
    file_path = get_upload_file_path(filename, upload_folder, allowed_extensions)
    if not file_path:
        if logger:
            logger.warning("Rejected unsafe image delete path: %r", filename)
        return False
    if os.path.exists(file_path):
        os.remove(file_path)
        return True
    return False


def process_image(image_file, target_height=720):
    image_file.stream.seek(0)
    with Image.open(image_file.stream) as candidate:
        candidate.verify()

    image_file.stream.seek(0)
    with Image.open(image_file.stream) as img:
        img = ImageOps.exif_transpose(img)
        width, height = img.size
        if not width or not height:
            raise ValueError('Invalid image dimensions')

        if height > target_height:
            ratio = target_height / height
            new_width = max(1, int(width * ratio))
            img = img.resize((new_width, target_height), Image.Resampling.LANCZOS)

        if img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGB')

        output = io.BytesIO()
        img.save(output, format='WebP', quality=85, optimize=True)
        return output.getvalue()

