import mimetypes
import os
from dataclasses import dataclass
from typing import Any

from flask import Response, request, send_from_directory, stream_with_context


@dataclass(frozen=True)
class MediaRouteDependencies:
    normalize_upload_filename: Any
    get_upload_folder: Any
    normalize_video_relative_path: Any
    get_video_library_abs_path: Any
    allowed_video_file: Any
    parse_byte_range: Any
    stream_file_slice: Any
    emby_request: Any
    log_exception: Any
    get_service_url: Any


class MediaRouteHandlers:
    def __init__(self, dependencies: MediaRouteDependencies):
        self.dependencies = dependencies

    def serve_image(self, filename):
        safe_filename = self.dependencies.normalize_upload_filename(filename)
        if not safe_filename:
            return Response(status=404)
        return send_from_directory(
            self.dependencies.get_upload_folder(),
            safe_filename,
            conditional=True
        )

    def serve_video(self, filename):
        safe_relative = self.dependencies.normalize_video_relative_path(filename)
        if not safe_relative or not self.dependencies.allowed_video_file(safe_relative):
            return Response(status=404)

        abs_path = self.dependencies.get_video_library_abs_path(safe_relative)
        if not abs_path or not os.path.isfile(abs_path):
            return Response(status=404)

        file_size = os.path.getsize(abs_path)
        content_type = mimetypes.guess_type(abs_path)[0] or 'application/octet-stream'
        range_header = request.headers.get('Range')
        byte_range = self.dependencies.parse_byte_range(range_header, file_size)
        common_headers = {
            'Accept-Ranges': 'bytes',
            'Content-Type': content_type
        }

        if range_header and byte_range is None:
            return Response(
                status=416,
                headers={
                    **common_headers,
                    'Content-Range': f'bytes */{file_size}',
                    'Content-Length': '0'
                }
            )

        if byte_range:
            start, end = byte_range
            status_code = 206
            response_headers = {
                **common_headers,
                'Content-Range': f'bytes {start}-{end}/{file_size}',
                'Content-Length': str(end - start + 1)
            }
        else:
            start, end = 0, max(file_size - 1, 0)
            status_code = 200
            response_headers = {
                **common_headers,
                'Content-Length': str(file_size)
            }

        if request.method == 'HEAD' or file_size == 0:
            return Response(status=status_code, headers=response_headers)

        return Response(
            stream_with_context(self.dependencies.stream_file_slice(abs_path, start, end)),
            status=status_code,
            headers=response_headers,
            direct_passthrough=True
        )

    def serve_emby_image(self, item_id):
        try:
            image_tag = request.args.get('tag', '').strip()
            params = {'tag': image_tag} if image_tag else None
            upstream = self.dependencies.emby_request(
                'GET',
                f'/emby/Items/{item_id}/Images/Primary',
                params=params,
                stream=True,
                timeout=20
            )

            if upstream.status_code == 404:
                upstream.close()
                return Response(status=404)
            if not upstream.ok:
                status_code = upstream.status_code
                upstream.close()
                return Response(status=status_code)

            response_headers = {
                'Content-Type': upstream.headers.get('Content-Type', 'image/jpeg'),
                'Cache-Control': 'private, max-age=86400'
            }
            if upstream.headers.get('Content-Length'):
                response_headers['Content-Length'] = upstream.headers['Content-Length']

            def generate():
                try:
                    for chunk in upstream.iter_content(chunk_size=8192):
                        if chunk:
                            yield chunk
                finally:
                    upstream.close()

            return Response(stream_with_context(generate()), headers=response_headers)
        except Exception as e:
            self.dependencies.log_exception('Emby image proxy', e)
            return Response(status=502)

    def stream_emby_video(self, item_id):
        try:
            upstream_headers = {}
            range_header = request.headers.get('Range')
            if range_header:
                upstream_headers['Range'] = range_header

            upstream = self.dependencies.emby_request(
                'GET',
                f'/emby/Videos/{item_id}/stream',
                params={'Static': 'true'},
                headers=upstream_headers,
                stream=True,
                timeout=(10, 60)
            )

            if upstream.status_code not in (200, 206):
                status_code = upstream.status_code
                upstream.close()
                return Response('Unable to stream this Emby item', status=status_code)

            response_headers = {}
            for header_name in (
                'Content-Type',
                'Content-Length',
                'Content-Range',
                'Accept-Ranges',
                'ETag',
                'Last-Modified'
            ):
                if upstream.headers.get(header_name):
                    response_headers[header_name] = upstream.headers[header_name]
            response_headers.setdefault('Accept-Ranges', 'bytes')

            def generate():
                try:
                    for chunk in upstream.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            yield chunk
                finally:
                    upstream.close()

            return Response(
                stream_with_context(generate()),
                status=upstream.status_code,
                headers=response_headers,
                direct_passthrough=True
            )
        except Exception as e:
            self.dependencies.log_exception('Emby stream proxy', e)
            return Response('Unable to stream this Emby item', status=502)

    def build_service_redirect_url(self, service_name):
        service_url = self.dependencies.get_service_url(service_name)
        if not service_url:
            return None

        path = request.args.get('path', '').strip()
        if path and not path.startswith('/'):
            path = f'/{path}'
        if '..' in path.replace('\\', '/').split('/'):
            return None
        return f'{service_url}{path}'


__all__ = ['MediaRouteDependencies', 'MediaRouteHandlers']
