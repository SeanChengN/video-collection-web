import os
import base64
import io
import ipaddress
import re
import socket
from urllib.parse import quote
from urllib.parse import unquote
from urllib.parse import urlsplit

from PIL import Image, UnidentifiedImageError


EXTERNAL_IMAGE_CHUNK_BYTES = 64 * 1024
EXTERNAL_IMAGE_USER_AGENT = 'video-collection-image-import/1.0'
EXTERNAL_IMAGE_SAFE_NAME_PATTERN = re.compile(r'[^A-Za-z0-9._-]+')


class ApiIntegrationHandlersMixin:
    def get_services_config_handler(self, data, method='GET'):
        try:
            return self.dependencies.jsonify({
                'success': True,
                'data': {
                    'auth_required': self.dependencies.access_token_required(),
                    'csrf_token': self.dependencies.get_csrf_token(),
                    'api_events': self.dependencies.api_event_metadata(),
                    'services': {
                        'emby': bool(os.environ.get('EMBY_SERVER_URL', '').strip()),
                        'jackett': bool(self.dependencies.get_service_url('jackett')),
                        'thunder': bool(self.dependencies.get_service_url('thunder'))
                    },
                    'service_routes': {
                        'jackett': '/services/jackett',
                        'thunder': '/services/thunder'
                    }
                }
            })
        except Exception as e:
                return self.dependencies.json_exception('Get services config', e)

    # 相似度计算相关代码
    def search_emby_handler(self, data, method='POST'):
        try:
            query = data.get('query', '').strip()
            if not query:
                return self.dependencies.jsonify({"success": False, "message": "Search query is required"}), 400

            response = self.dependencies.emby_request(
                'GET',
                '/emby/Items',
                params={
                    'Recursive': 'true',
                    'IncludeItemTypes': 'Movie',
                    'NameStartsWith': query
                }
            )

            if not response.ok:
                status_code = response.status_code
                response.close()
                return self.dependencies.jsonify({
                    "success": False,
                    "message": f"Emby search failed: HTTP {status_code}"
                }), status_code

            emby_data = response.json()
            items = []
            for item in emby_data.get('Items', []):
                item_id = str(item.get('Id', '')).strip()
                if not item_id:
                    continue

                image_tag = (item.get('ImageTags') or {}).get('Primary', '')
                image_url = f'/emby/image/{quote(item_id, safe="")}'
                if image_tag:
                    image_url = f'{image_url}?tag={quote(str(image_tag), safe="")}'

                items.append({
                    'id': item_id,
                    'name': item.get('Name', ''),
                    'runtimeTicks': item.get('RunTimeTicks'),
                    'imageTag': image_tag,
                    'imageUrl': image_url,
                    'streamUrl': f'/emby/stream/{quote(item_id, safe="")}'
                })

            return self.dependencies.jsonify({
                "success": True,
                "data": {
                    "items": items,
                    "totalRecordCount": emby_data.get('TotalRecordCount', len(items))
                }
            })
        except Exception as e:
            return self.dependencies.json_exception('Emby search', e, 'Emby search failed')

    def external_image_host_is_public(self, hostname, port=443):
        normalized_host = (hostname or '').strip().strip('[]')
        if not normalized_host:
            return False
        if normalized_host.lower() in {'localhost'} or normalized_host.lower().endswith('.localhost'):
            return False

        try:
            candidate_ip = ipaddress.ip_address(normalized_host)
            return candidate_ip.is_global
        except ValueError:
            pass

        try:
            idna_host = normalized_host.encode('idna').decode('ascii')
            address_infos = socket.getaddrinfo(idna_host, port or 443, type=socket.SOCK_STREAM)
        except (OSError, UnicodeError):
            return False

        resolved_addresses = {
            info[4][0].split('%', 1)[0]
            for info in address_infos
            if info and len(info) > 4 and info[4]
        }
        if not resolved_addresses:
            return False

        try:
            return all(ipaddress.ip_address(address).is_global for address in resolved_addresses)
        except ValueError:
            return False

    def validate_external_image_url(self, url):
        try:
            parsed = urlsplit(url)
            port = parsed.port
        except ValueError:
            return None

        if parsed.scheme.lower() != 'https':
            return None
        if not parsed.hostname or parsed.username or parsed.password:
            return None
        if port not in (None, 443):
            return None
        if not self.external_image_host_is_public(parsed.hostname, port or 443):
            return None
        return parsed

    def external_image_filename(self, parsed_url):
        basename = os.path.basename(unquote(parsed_url.path or '')) or 'wtl-screenshot'
        stem = os.path.splitext(basename)[0] or 'wtl-screenshot'
        safe_stem = EXTERNAL_IMAGE_SAFE_NAME_PATTERN.sub('_', stem).strip('._-') or 'wtl-screenshot'
        return f'{safe_stem[:80]}.jpg'

    def read_external_image_response(self, response, max_bytes):
        content_length = response.headers.get('Content-Length', '')
        if content_length:
            try:
                if int(content_length) > max_bytes:
                    return None, 413, 'External image is too large'
            except ValueError:
                pass

        content_type = response.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
        if not content_type.startswith('image/') or content_type == 'image/svg+xml':
            return None, 400, 'External URL did not return a supported image'

        image_bytes = bytearray()
        for chunk in response.iter_content(EXTERNAL_IMAGE_CHUNK_BYTES):
            if not chunk:
                continue
            image_bytes.extend(chunk)
            if len(image_bytes) > max_bytes:
                return None, 413, 'External image is too large'

        if not image_bytes:
            return None, 400, 'External image was empty'
        return bytes(image_bytes), None, None

    def external_image_bytes_to_jpeg_data_url(self, image_bytes, max_bytes):
        try:
            with Image.open(io.BytesIO(image_bytes)) as image:
                image.load()
                if image.mode not in {'RGB', 'L'}:
                    image = image.convert('RGB')
                elif image.mode == 'L':
                    image = image.convert('RGB')

                output = io.BytesIO()
                image.save(output, format='JPEG', quality=90, optimize=True)
        except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError):
            return None, 400, 'External image is invalid or unsupported'

        encoded_bytes = output.getvalue()
        if len(encoded_bytes) > max_bytes:
            return None, 413, 'External image is too large'

        encoded = base64.b64encode(encoded_bytes).decode('ascii')
        return f'data:image/jpeg;base64,{encoded}', None, None

    def fetch_external_image_handler(self, data, method='POST'):
        try:
            image_url = (data or {}).get('url', '').strip()
            parsed_url = self.validate_external_image_url(image_url)
            if not parsed_url:
                return self.dependencies.jsonify({
                    'success': False,
                    'message': 'Unsupported external image URL'
                }), 400

            max_bytes = int(self.dependencies.get_max_image_upload_bytes())
            response = self.dependencies.external_image_get(
                image_url,
                stream=True,
                timeout=(5, 15),
                allow_redirects=False,
                headers={
                    'Accept': 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8',
                    'User-Agent': EXTERNAL_IMAGE_USER_AGENT
                }
            )

            try:
                status_code = getattr(response, 'status_code', 0)
                if status_code < 200 or status_code >= 300:
                    return self.dependencies.jsonify({
                        'success': False,
                        'message': f'External image fetch failed: HTTP {status_code}'
                    }), 502

                image_bytes, error_status, error_message = self.read_external_image_response(response, max_bytes)
                if error_status:
                    return self.dependencies.jsonify({
                        'success': False,
                        'message': error_message
                    }), error_status

                data_url, error_status, error_message = self.external_image_bytes_to_jpeg_data_url(image_bytes, max_bytes)
                if error_status:
                    return self.dependencies.jsonify({
                        'success': False,
                        'message': error_message
                    }), error_status

                return self.dependencies.jsonify({
                    'success': True,
                    'data_url': data_url,
                    'filename': self.external_image_filename(parsed_url),
                    'content_type': 'image/jpeg'
                })
            finally:
                close = getattr(response, 'close', None)
                if callable(close):
                    close()
        except Exception as e:
            self.dependencies.logger.warning("External image import failed: %s", e)
            return self.dependencies.jsonify({
                'success': False,
                'message': 'External image fetch failed'
            }), 502

    def check_title_match(self, title1, title2):
        # 转换为小写进行比较
        t1 = title1.lower()
        t2 = title2.lower()

        # 如果标题1以 "FC2-" 开头，取最后一个部分
        if t1.startswith('fc2-'):
            t1 = t1.split('-')[-1]
        
        # 如果标题2以 "FC2-" 开头，取最后一个部分
        if t2.startswith('fc2-'):
            t2 = t2.split('-')[-1]

        # 两者互相包含都算匹配
        return t1 in t2 or t2 in t1

    # 查重核对相关代码
    def check_duplicates_handler(self, data, method='POST'): 
        try:
            titles = data.get('titles', [])
            
            with self.dependencies.get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT title FROM movies")
                existing_titles = [row[0] for row in cursor.fetchall()]
                
                duplicates = []
                matched_titles = {}
                
                for title in titles:
                    # 检查完全匹配
                    if title in existing_titles:
                        duplicates.append(title)
                        matched_titles[title] = title
                        continue
                    
                    # 检查互相包含匹配
                    for existing in existing_titles:
                        if self.check_title_match(title, existing):
                            duplicates.append(title)
                            matched_titles[title] = existing
                            break
                
                return self.dependencies.jsonify({
                    "success": True,
                    "duplicates": duplicates,
                    "matched_titles": matched_titles
                })
        except Exception as e:
            return self.dependencies.json_exception('Check duplicates', e)

    # 设置功能相关代码
