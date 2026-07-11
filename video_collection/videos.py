import os
import re
import stat
from urllib.parse import quote


ALLOWED_VIDEO_EXTENSIONS = {
    'mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'flv', 'ts'
}


def normalize_video_relative_path(path_value=''):
    rel_path = (path_value or '').strip().replace('\\', '/').strip('/')
    if not rel_path or rel_path == '.':
        return ''

    parts = []
    for part in rel_path.split('/'):
        if not part or part == '.':
            continue
        if part == '..':
            return None
        parts.append(part)
    return '/'.join(parts)


def get_video_library_abs_path(relative_path='', video_library_root='/videos'):
    safe_relative = normalize_video_relative_path(relative_path)
    if safe_relative is None:
        return None

    root_path = os.path.realpath(video_library_root)
    candidate_path = os.path.realpath(os.path.join(root_path, *safe_relative.split('/'))) if safe_relative else root_path
    try:
        if os.path.commonpath([root_path, candidate_path]) != root_path:
            return None
    except ValueError:
        return None
    return candidate_path


def allowed_video_file(filename, allowed_extensions=ALLOWED_VIDEO_EXTENSIONS):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_extensions


def parse_byte_range(range_header, file_size):
    if not range_header:
        return None

    match = re.fullmatch(r'bytes=(\d*)-(\d*)', range_header.strip())
    if not match:
        return None

    start_text, end_text = match.groups()
    if not start_text and not end_text:
        return None

    try:
        if start_text:
            start = int(start_text)
            end = int(end_text) if end_text else file_size - 1
        else:
            suffix_length = int(end_text)
            if suffix_length <= 0:
                return None
            start = max(file_size - suffix_length, 0)
            end = file_size - 1
    except ValueError:
        return None

    if file_size <= 0 or start >= file_size or end < start:
        return None

    return start, min(end, file_size - 1)


def stream_file_slice(abs_path, start, end, chunk_bytes):
    with open(abs_path, 'rb') as file_handle:
        file_handle.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = file_handle.read(min(chunk_bytes, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def format_video_file_item(directory_relative_path, filename, video_library_root='/videos'):
    relative_path = '/'.join(part for part in [directory_relative_path, filename] if part)
    abs_path = get_video_library_abs_path(relative_path, video_library_root)
    stat_result = os.stat(abs_path)
    return {
        'name': filename,
        'path': relative_path,
        'size': stat_result.st_size,
        'modified': int(stat_result.st_mtime),
        'url': f"/videos/{quote(relative_path, safe='/')}"
    }


def delete_video_file(relative_path, video_library_root='/videos'):
    safe_relative_path = normalize_video_relative_path(relative_path)
    if not safe_relative_path or not allowed_video_file(os.path.basename(safe_relative_path)):
        raise ValueError('Invalid video file path')

    abs_path = get_video_library_abs_path(safe_relative_path, video_library_root)
    if not abs_path:
        raise ValueError('Invalid video file path')

    stat_result = os.lstat(abs_path)
    if not stat.S_ISREG(stat_result.st_mode):
        raise ValueError('Video path is not a regular file')

    os.remove(abs_path)
    return safe_relative_path
