import os
import time
import uuid

from flask import request
from PIL import Image, UnidentifiedImageError


class ApiMediaHandlersMixin:
    def list_video_files_handler(self, data, method='POST'):
        try:
            relative_path = self.dependencies.normalize_video_relative_path((data or {}).get('path', ''))
            if relative_path is None:
                return self.dependencies.jsonify({"success": False, "message": "Invalid video directory"}), 400

            directory_path = self.dependencies.get_video_library_abs_path(relative_path)
            if not directory_path or not os.path.isdir(directory_path):
                return self.dependencies.jsonify({
                    "success": True,
                    "path": relative_path,
                    "parent": self.dependencies.normalize_video_relative_path(os.path.dirname(relative_path)) if relative_path else '',
                    "directories": [],
                    "files": [],
                    "message": "Video directory is not available"
                })

            directories = []
            files = []
            for entry in os.scandir(directory_path):
                if entry.name.startswith('.'):
                    continue

                entry_relative_path = '/'.join(part for part in [relative_path, entry.name] if part)
                try:
                    if entry.is_dir(follow_symlinks=False):
                        directories.append({
                            'name': entry.name,
                            'path': entry_relative_path
                        })
                    elif entry.is_file(follow_symlinks=False) and self.dependencies.allowed_video_file(entry.name):
                        files.append(self.dependencies.format_video_file_item(relative_path, entry.name))
                except OSError:
                    continue

            directories.sort(key=lambda item: item['name'].lower())
            files.sort(key=lambda item: item['name'].lower())

            return self.dependencies.jsonify({
                "success": True,
                "path": relative_path,
                "parent": self.dependencies.normalize_video_relative_path(os.path.dirname(relative_path)) if relative_path else '',
                "directories": directories,
                "files": files
            })
        except Exception as e:
            return self.dependencies.json_exception('List video files', e, 'Unable to list video files')

    def upload_image_handler(self, data, method='POST'):
        if 'image' not in request.files:
            return self.dependencies.jsonify({'success': False, 'message': '没有文件'}), 400
            
        file = request.files['image']
     
        if not file or not self.dependencies.allowed_file(file.filename):
            return self.dependencies.jsonify({'success': False, 'message': '仅支持 PNG/JPG/JPEG 图片'}), 400

        timestamp = int(time.time())
        unique_id = str(uuid.uuid4())[:8]
        image_year = time.strftime('%Y', time.localtime(timestamp))
        filename = f"{image_year}/{timestamp}_{unique_id}.webp"
        os.makedirs(self.dependencies.get_upload_folder(), exist_ok=True)

        try:
            processed_image = self.dependencies.process_image(file)
            file_path = self.dependencies.get_upload_file_path(filename)
            if not file_path:
                self.dependencies.logger.error("Generated upload filename was rejected: %s", filename)
                return self.dependencies.jsonify({'success': False, 'message': '图片保存失败'}), 500

            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, 'wb') as f:
                f.write(processed_image)
            return self.dependencies.jsonify({
                'success': True,
                'filename': filename
            })
        except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as e:
            self.dependencies.logger.warning("Rejected image upload %r: %s", file.filename, e)
            return self.dependencies.jsonify({'success': False, 'message': '图片无效或无法处理'}), 400
        except Exception as e:
            self.dependencies.log_exception('Image upload', e)
            return self.dependencies.jsonify({'success': False, 'message': '图片处理失败'}), 500

