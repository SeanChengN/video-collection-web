import json
import os
import time
import types
import uuid
from urllib.parse import quote

import mysql.connector
from flask import request
from PIL import Image, UnidentifiedImageError

def add_movie_handler(data, method='POST'):
    try:
        title = data.get('title')
        recommended = 1 if data.get('recommended') else 0
        review = data.get('review', '')
        ratings = data.get('ratings', '')
        image_filenames = data.get('image_filenames', '')

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO movies (title, recommended, review)
                VALUES (%s, %s, %s)
            """, (title, recommended, review))
            replace_movie_images(cursor, title, image_filenames)
            sync_movie_metadata(cursor, title, data.get('tags', ''), ratings)
            conn.commit()
        return jsonify({"message": "电影添加成功"}), 200
    except mysql.connector.Error as err:
        log_exception('Add movie', err)
        return jsonify({"error": "电影添加失败"}), 500

def update_movie_handler(data, method='PUT'):
    try:
        title = data.get('title')
        recommended = 1 if data.get('recommended') else 0
        review = data.get('review', '')
        ratings = data.get('ratings', '')
        image_filenames = data.get('image_filenames', '')
        original_images = json.loads(data.get('original_images', '[]'))
        if not isinstance(original_images, list):
            original_images = []
        current_images = set(parse_image_filenames(image_filenames))
        original_images_set = {
            filename
            for filename in (normalize_upload_filename(filename) for filename in original_images)
            if filename
        }
        images_to_delete = original_images_set - current_images

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 更新数据库记录
            cursor.execute("""
                UPDATE movies 
                SET recommended = %s, review = %s
                WHERE title = %s
            """, (recommended, review, title))
            replace_movie_images(cursor, title, image_filenames)
            sync_movie_metadata(cursor, title, data.get('tags', ''), ratings)
            conn.commit()
            delete_unreferenced_uploaded_images(cursor, images_to_delete)
			
        return jsonify({"message": "电影更新成功"}), 200

    except Exception as e:
        return json_exception('Update movie', e, '电影更新失败')

def get_ratings_dimensions_handler(data, method='GET'):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT * FROM ratings_dimensions ORDER BY id")
            dimensions = cursor.fetchall()
            return jsonify({"success": True, "dimensions": dimensions})
    except Exception as e:
        return json_exception('Get ratings dimensions', e)

def search_movies_sql_handler(data):
    data = data or {}
    search_term = str(data.get('title') or '').strip()
    rating_dimension = str(data.get('rating_dimension') or '').strip()
    min_rating_raw = str(data.get('min_rating') or '').strip()
    recommended_raw = data.get('recommended')
    recommended_filter = '' if recommended_raw is None else str(recommended_raw).strip()
    selected_tag_names = parse_tag_names(data.get('tags', ''))
    page = parse_positive_int(data.get('page'), 1, 1)
    per_page = parse_positive_int(data.get('per_page'), 10, 1, 100)

    if recommended_filter and recommended_filter not in ('0', '1'):
        return json_error('Invalid recommended filter', 400)

    with get_db_connection() as conn:
        cursor = conn.cursor(dictionary=True)
        where_clauses = []
        params = []

        if search_term:
            where_clauses.append("(m.title LIKE %s OR m.review LIKE %s)")
            params.extend([f'%{search_term}%', f'%{search_term}%'])

        if recommended_filter:
            where_clauses.append("m.recommended = %s")
            params.append(1 if recommended_filter == '1' else 0)

        if selected_tag_names:
            tag_ids = resolve_tag_ids(cursor, selected_tag_names)
            if len(tag_ids) != len(selected_tag_names):
                return jsonify({
                    "success": True,
                    "data": [],
                    "pagination": {
                        "page": 1,
                        "per_page": per_page,
                        "total": 0,
                        "total_pages": 0
                    }
                })

            for index, tag_id in enumerate(tag_ids):
                alias = f"mt_filter_{index}"
                where_clauses.append(
                    f"EXISTS (SELECT 1 FROM movie_tags {alias} "
                    f"WHERE {alias}.movie_title = m.title AND {alias}.tag_id = %s)"
                )
                params.append(tag_id)

        min_rating = None
        if min_rating_raw:
            min_rating = parse_positive_int(min_rating_raw, None, 1, 5)
            if min_rating is None:
                return json_error('Invalid minimum rating', 400)

        rating_dimension_id = None
        if rating_dimension:
            rating_dimension_id = resolve_rating_dimension_id(cursor, rating_dimension)
            if rating_dimension_id is None:
                return jsonify({
                    "success": True,
                    "data": [],
                    "pagination": {
                        "page": 1,
                        "per_page": per_page,
                        "total": 0,
                        "total_pages": 0
                    }
                })

        if min_rating is not None and rating_dimension_id is not None:
            where_clauses.append("""
                COALESCE((
                    SELECT mr_filter.rating
                    FROM movie_ratings mr_filter
                    WHERE mr_filter.movie_title = m.title
                      AND mr_filter.dimension_id = %s
                    LIMIT 1
                ), 3) >= %s
            """)
            params.extend([rating_dimension_id, min_rating])
        elif min_rating is not None:
            where_clauses.append("""
                NOT EXISTS (
                    SELECT 1
                    FROM ratings_dimensions rd_filter
                    LEFT JOIN movie_ratings mr_low
                      ON mr_low.dimension_id = rd_filter.id
                     AND mr_low.movie_title = m.title
                    WHERE COALESCE(mr_low.rating, 3) < %s
                )
            """)
            params.append(min_rating)

        where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        cursor.execute(f"SELECT COUNT(*) AS total FROM movies m{where_sql}", params)
        total = cursor.fetchone()['total']
        total_pages = (total + per_page - 1) // per_page if total else 0
        if total_pages and page > total_pages:
            page = total_pages
        offset = (page - 1) * per_page if total else 0

        query_params = list(params)
        query_params.extend([per_page, offset])
        cursor.execute(f"""
            SELECT m.title, m.recommended, m.review, m.added_date
            FROM movies m
            {where_sql}
            ORDER BY m.added_date DESC
            LIMIT %s OFFSET %s
        """, query_params)
        movies = hydrate_movie_rows(cursor, cursor.fetchall())

        return jsonify({
            "success": True,
            "data": movies,
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "total_pages": total_pages
            }
        })

def search_movies_handler(data, method='GET'):
    try:
        return search_movies_sql_handler(data)
    except Exception as e:
        return json_exception('Search movies', e, '搜索失败')

def get_tags_handler(data, method='GET'):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT id, name FROM tags")
            tags = [tag['name'] for tag in cursor.fetchall()]
            return jsonify({"success": True, "data": tags})
    except Exception as e:
        return json_exception('Get tags', e)

# 从环境变量中读取参数
def get_services_config_handler(data, method='GET'):
    try:
        return jsonify({
            'success': True,
            'data': {
                'auth_required': access_token_required(),
                'csrf_token': get_csrf_token(),
                'api_events': api_event_metadata(),
                'services': {
                    'emby': bool(os.environ.get('EMBY_SERVER_URL', '').strip()),
                    'jackett': bool(get_service_url('jackett')),
                    'thunder': bool(get_service_url('thunder'))
                },
                'service_routes': {
                    'jackett': '/services/jackett',
                    'thunder': '/services/thunder'
                }
            }
        })
    except Exception as e:
            return json_exception('Get services config', e)

# 相似度计算相关代码
def search_emby_handler(data, method='POST'):
    try:
        query = data.get('query', '').strip()
        if not query:
            return jsonify({"success": False, "message": "Search query is required"}), 400

        response = emby_request(
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
            return jsonify({
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

        return jsonify({
            "success": True,
            "data": {
                "items": items,
                "totalRecordCount": emby_data.get('TotalRecordCount', len(items))
            }
        })
    except Exception as e:
        return json_exception('Emby search', e, 'Emby search failed')

def check_title_match(title1, title2):
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
def check_duplicates_handler(data, method='POST'): 
    try:
        titles = data.get('titles', [])
        
        with get_db_connection() as conn:
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
                    if check_title_match(title, existing):
                        duplicates.append(title)
                        matched_titles[title] = existing
                        break
            
            return jsonify({
                "success": True,
                "duplicates": duplicates,
                "matched_titles": matched_titles
            })
    except Exception as e:
        return json_exception('Check duplicates', e)

# 设置功能相关代码
def add_tag_handler(data, method='POST'):
    try:
        name = data.get('name', '').strip()
        
        if not name:
            return jsonify({"success": False, "message": "标签名称不能为空"}), 400
            
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO tags (name) VALUES (%s)", (name,))
            conn.commit()
            
        return jsonify({"success": True})
    except mysql.connector.Error as err:
        if err.errno == 1062:  # 重复键错误
            return jsonify({"success": False, "message": "标签名称已存在"}), 400
        log_exception('Add tag', err)
        return json_error('标签添加失败', 500)

def update_tag_handler(data, method='POST'):
    try:
        old_name = data.get('old_name', '').strip()
        new_name = data.get('new_name', '').strip()
        
        if not old_name or not new_name:
            return jsonify({"success": False, "message": "标签名称不能为空"}), 400
            
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE tags SET name = %s WHERE name = %s", (new_name, old_name))
            conn.commit()
            
        return jsonify({"success": True})
    except mysql.connector.Error as err:
        if err.errno == 1062:  # 重复键错误
            return jsonify({"success": False, "message": "标签名称已存在"}), 400
        log_exception('Update tag', err)
        return json_error('标签更新失败', 500)

def delete_tag_handler(data, method='DELETE'):
    try:
        data = data or {}
        name = data.get('name', '').strip()
        preview = bool(data.get('preview'))
        confirm = bool(data.get('confirm'))

        if not name:
            return jsonify({"success": False, "message": "标签名称不能为空"}), 400

        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT id, name FROM tags WHERE name = %s", (name,))
            tag = cursor.fetchone()
            if not tag:
                return jsonify({"success": False, "message": "标签不存在"}), 404

            cursor.execute(
                "SELECT COUNT(DISTINCT movie_title) AS usage_count FROM movie_tags WHERE tag_id = %s",
                (tag['id'],)
            )
            usage_count = cursor.fetchone()['usage_count']

            if preview or not confirm:
                return jsonify({
                    "success": True,
                    "exists": True,
                    "usage_count": usage_count,
                    "name": tag['name']
                })

            cursor.execute("DELETE FROM movie_tags WHERE tag_id = %s", (tag['id'],))
            cursor.execute("DELETE FROM tags WHERE id = %s", (tag['id'],))
            conn.commit()

        return jsonify({"success": True, "usage_count": usage_count})
    except Exception as e:
        return json_exception('Delete tag', e, '标签删除失败')

def add_rating_dimension_handler(data, method='POST'):
    try:
        name = data.get('name', '').strip()
        
        if not name:
            return jsonify({"success": False, "message": "评分维度名称不能为空"}), 400
            
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO ratings_dimensions (name) VALUES (%s)", (name,))
            conn.commit()
            
        return jsonify({"success": True})
    except mysql.connector.Error as err:
        if err.errno == 1062:  # 重复键错误
            return jsonify({"success": False, "message": "评分维度名称已存在"}), 400
        log_exception('Add rating dimension', err)
        return json_error('评分维度添加失败', 500)

def update_rating_dimension_handler(data, method='POST'):
    try:
        old_name = data.get('old_name', '').strip()
        new_name = data.get('new_name', '').strip()
        
        if not old_name or not new_name:
            return jsonify({"success": False, "message": "评分维度名称不能为空"}), 400
            
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE ratings_dimensions SET name = %s WHERE name = %s", (new_name, old_name))
            conn.commit()
            # 这里没有检查是否真的更新了记录
            
        return jsonify({"success": True})
    except mysql.connector.Error as err:
        if err.errno == 1062:  # 重复键错误
            return jsonify({"success": False, "message": "评分维度名称已存在"}), 400
        log_exception('Update rating dimension', err)
        return json_error('评分维度更新失败', 500)

def delete_rating_dimension_handler(data, method='DELETE'):
    try:
        data = data or {}
        dimension_id = parse_positive_int(data.get('id') or data.get('dimension_id'), None, 1)
        preview = bool(data.get('preview'))
        confirm = bool(data.get('confirm'))

        if dimension_id is None:
            return jsonify({"success": False, "message": "评分维度无效"}), 400

        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT id, name FROM ratings_dimensions WHERE id = %s", (dimension_id,))
            dimension = cursor.fetchone()
            if not dimension:
                return jsonify({"success": False, "message": "评分维度不存在"}), 404

            cursor.execute(
                "SELECT COUNT(DISTINCT movie_title) AS usage_count FROM movie_ratings WHERE dimension_id = %s",
                (dimension_id,)
            )
            usage_count = cursor.fetchone()['usage_count']

            if preview or not confirm:
                return jsonify({
                    "success": True,
                    "exists": True,
                    "usage_count": usage_count,
                    "id": dimension['id'],
                    "name": dimension['name']
                })

            cursor.execute("DELETE FROM movie_ratings WHERE dimension_id = %s", (dimension_id,))
            cursor.execute("DELETE FROM ratings_dimensions WHERE id = %s", (dimension_id,))
            conn.commit()

        return jsonify({"success": True, "usage_count": usage_count})
    except Exception as e:
        return json_exception('Delete rating dimension', e, '评分维度删除失败')

def delete_movie_handler(data, method='DELETE'):
    try:
        title = data.get('title')
        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            
            # 首先检查电影是否存在
            cursor.execute("SELECT title FROM movies WHERE title = %s", (title,))
            if not cursor.fetchone():
                return jsonify({"success": False, "message": "电影名称不存在"}), 404
            
            image_files = get_movie_image_filenames(cursor, title)

            # 删除数据库记录
            cursor.execute("DELETE FROM movie_tags WHERE movie_title = %s", (title,))
            cursor.execute("DELETE FROM movie_ratings WHERE movie_title = %s", (title,))
            cursor.execute("DELETE FROM movie_images WHERE movie_title = %s", (title,))
            cursor.execute("DELETE FROM movies WHERE title = %s", (title,))
            conn.commit()
            delete_unreferenced_uploaded_images(cursor, image_files)
            
            return jsonify({"success": True, "message": "电影删除成功"})

    except Exception as e:
        log_exception('Delete movie', e)
        return jsonify({"success": False, "message": "删除操作失败"}), 500

def list_db_backups_handler(data, method='GET'):
    try:
        database_status = 'ok'
        upgrade_diagnostics = get_database_upgrade_diagnostics()
        try:
            check_database_connection()
        except Exception as e:
            database_status = 'error'
            logger.warning("Maintenance database probe failed: %s", e)

        if not access_token_required():
            return jsonify({
                "success": True,
                "maintenance_enabled": False,
                "database_status": database_status,
                "scheduled_backup": get_scheduled_backup_status(),
                "backups": [],
                **upgrade_diagnostics
            })

        return jsonify({
            "success": True,
            "maintenance_enabled": True,
            "database_status": database_status,
            "scheduled_backup": get_scheduled_backup_status(),
            "backups": list_database_backups(),
            **upgrade_diagnostics
        })
    except Exception as e:
        return json_exception('List database backups', e, '备份列表读取失败')

def create_db_backup_handler(data, method='POST'):
    if not backup_feature_enabled():
        return jsonify({"success": False, "message": "请先配置 APP_ACCESS_TOKEN 后再使用备份功能"}), 403

    if not DB_MAINTENANCE_LOCK.acquire(blocking=False):
        return jsonify({"success": False, "message": "已有数据库维护任务正在执行，请稍后再试"}), 409

    try:
        backup = run_database_backup()
        return jsonify({
            "success": True,
            "message": "完整备份已创建",
            "backup": backup,
            "backups": list_database_backups()
        })
    except FileNotFoundError as e:
        log_exception('Create database backup', e)
        return json_error('数据库备份工具不可用，请确认容器已安装 mariadb-client', 500)
    except DatabaseUpgradeRequiredError as e:
        logger.warning("Create database backup requires MariaDB upgrade: %s", e)
        return jsonify({
            "success": False,
            "message": str(e),
            "database_upgrade_required": True,
            "database_upgrade_command": database_upgrade_command_hint()
        }), 500
    except Exception as e:
        return json_exception('Create database backup', e, '数据库备份失败')
    finally:
        DB_MAINTENANCE_LOCK.release()

def restore_db_backup_handler(data, method='POST'):
    if not backup_feature_enabled():
        return jsonify({"success": False, "message": "请先配置 APP_ACCESS_TOKEN 后再使用恢复功能"}), 403

    data = data or {}
    filename = safe_backup_filename(data.get('filename', ''))
    confirm = bool(data.get('confirm'))
    if not filename:
        return jsonify({"success": False, "message": "备份文件名无效"}), 400
    if not confirm:
        return jsonify({"success": False, "message": "请确认后再执行恢复"}), 400
    if not get_backup_file_path(filename, must_exist=True):
        return jsonify({"success": False, "message": "备份文件不存在"}), 404

    if not DB_MAINTENANCE_LOCK.acquire(blocking=False):
        return jsonify({"success": False, "message": "已有数据库维护任务正在执行，请稍后再试"}), 409

    try:
        pre_restore_backup = run_database_backup(prefix='pre_restore_')
        restore_result = run_backup_restore(filename)
        return jsonify({
            "success": True,
            "message": "备份恢复已完成",
            "pre_restore_backup": pre_restore_backup,
            "restored_backup": restore_result
        })
    except FileNotFoundError as e:
        log_exception('Restore database backup', e)
        return json_error('数据库恢复工具或备份文件不可用', 500)
    except DatabaseUpgradeRequiredError as e:
        logger.warning("Restore pre-backup requires MariaDB upgrade: %s", e)
        return jsonify({
            "success": False,
            "message": str(e),
            "database_upgrade_required": True,
            "database_upgrade_command": database_upgrade_command_hint()
        }), 500
    except Exception as e:
        return json_exception('Restore database backup', e, '数据库恢复失败')
    finally:
        DB_MAINTENANCE_LOCK.release()

def delete_db_backup_handler(data, method='DELETE'):
    if not backup_feature_enabled():
        return jsonify({"success": False, "message": "请先配置 APP_ACCESS_TOKEN 后再使用备份删除功能"}), 403

    data = data or {}
    filename = safe_backup_filename(data.get('filename', ''))
    confirm = bool(data.get('confirm'))
    if not filename:
        return jsonify({"success": False, "message": "备份文件名无效"}), 400
    if not confirm:
        return jsonify({"success": False, "message": "请确认后再删除备份"}), 400

    if not DB_MAINTENANCE_LOCK.acquire(blocking=False):
        return jsonify({"success": False, "message": "已有数据库维护任务正在执行，请稍后再试"}), 409

    try:
        deleted_filename = delete_database_backup_file(filename)
        return jsonify({
            "success": True,
            "message": "备份文件已删除",
            "deleted_filename": deleted_filename,
            "backups": list_database_backups()
        })
    except FileNotFoundError:
        return jsonify({"success": False, "message": "备份文件不存在"}), 404
    except ValueError:
        return jsonify({"success": False, "message": "备份文件名无效"}), 400
    except Exception as e:
        return json_exception('Delete database backup', e, '备份删除失败')
    finally:
        DB_MAINTENANCE_LOCK.release()

# 图片文件验证
def list_video_files_handler(data, method='POST'):
    try:
        relative_path = normalize_video_relative_path((data or {}).get('path', ''))
        if relative_path is None:
            return jsonify({"success": False, "message": "Invalid video directory"}), 400

        directory_path = get_video_library_abs_path(relative_path)
        if not directory_path or not os.path.isdir(directory_path):
            return jsonify({
                "success": True,
                "path": relative_path,
                "parent": normalize_video_relative_path(os.path.dirname(relative_path)) if relative_path else '',
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
                elif entry.is_file(follow_symlinks=False) and allowed_video_file(entry.name):
                    files.append(format_video_file_item(relative_path, entry.name))
            except OSError:
                continue

        directories.sort(key=lambda item: item['name'].lower())
        files.sort(key=lambda item: item['name'].lower())

        return jsonify({
            "success": True,
            "path": relative_path,
            "parent": normalize_video_relative_path(os.path.dirname(relative_path)) if relative_path else '',
            "directories": directories,
            "files": files
        })
    except Exception as e:
        return json_exception('List video files', e, 'Unable to list video files')

def upload_image_handler(data, method='POST'):
    if 'image' not in request.files:
        return jsonify({'success': False, 'message': '没有文件'}), 400
        
    file = request.files['image']
 
    if not file or not allowed_file(file.filename):
        return jsonify({'success': False, 'message': '仅支持 PNG/JPG/JPEG 图片'}), 400

    timestamp = int(time.time())
    unique_id = str(uuid.uuid4())[:8]
    image_year = time.strftime('%Y', time.localtime(timestamp))
    filename = f"{image_year}/{timestamp}_{unique_id}.webp"
    os.makedirs(get_upload_folder(), exist_ok=True)

    try:
        processed_image = process_image(file)
        file_path = get_upload_file_path(filename)
        if not file_path:
            logger.error("Generated upload filename was rejected: %s", filename)
            return jsonify({'success': False, 'message': '图片保存失败'}), 500

        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, 'wb') as f:
            f.write(processed_image)
        return jsonify({
            'success': True,
            'filename': filename
        })
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as e:
        logger.warning("Rejected image upload %r: %s", file.filename, e)
        return jsonify({'success': False, 'message': '图片无效或无法处理'}), 400
    except Exception as e:
        log_exception('Image upload', e)
        return jsonify({'success': False, 'message': '图片处理失败'}), 500


HANDLER_NAMES = (
    'add_movie_handler',
    'update_movie_handler',
    'get_ratings_dimensions_handler',
    'search_movies_handler',
    'get_tags_handler',
    'get_services_config_handler',
    'search_emby_handler',
    'check_duplicates_handler',
    'add_tag_handler',
    'update_tag_handler',
    'delete_tag_handler',
    'add_rating_dimension_handler',
    'update_rating_dimension_handler',
    'delete_rating_dimension_handler',
    'delete_movie_handler',
    'list_db_backups_handler',
    'create_db_backup_handler',
    'restore_db_backup_handler',
    'delete_db_backup_handler',
    'list_video_files_handler',
    'upload_image_handler',
)

HELPER_NAMES = (
    'search_movies_sql_handler',
    'check_title_match',
)


class ApiHandlers:
    def __init__(self, **dependencies):
        namespace = dict(globals())
        namespace.update(dependencies)
        namespace.setdefault('__builtins__', __builtins__)
        self._namespace = namespace

        for name in HELPER_NAMES:
            namespace[name] = self._bind(globals()[name])
        for name in HANDLER_NAMES:
            setattr(self, name, self._bind(globals()[name]))

    def _bind(self, function):
        return types.FunctionType(
            function.__code__,
            self._namespace,
            function.__name__,
            function.__defaults__,
            function.__closure__
        )


__all__ = ['ApiHandlers']