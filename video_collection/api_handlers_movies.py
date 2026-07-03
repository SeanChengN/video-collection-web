import json

import mysql.connector


class ApiMovieHandlersMixin:
    def add_movie_handler(self, data, method='POST'):
        try:
            title = data.get('title')
            recommended = 1 if data.get('recommended') else 0
            review = data.get('review', '')
            ratings = data.get('ratings', '')
            image_filenames = data.get('image_filenames', '')

            with self.dependencies.get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO movies (title, recommended, review)
                    VALUES (%s, %s, %s)
                """, (title, recommended, review))
                self.dependencies.replace_movie_images(cursor, title, image_filenames)
                self.dependencies.sync_movie_metadata(cursor, title, data.get('tags', ''), ratings)
                conn.commit()
            return self.dependencies.jsonify({"message": "电影添加成功"}), 200
        except mysql.connector.Error as err:
            self.dependencies.log_exception('Add movie', err)
            return self.dependencies.jsonify({"error": "电影添加失败"}), 500

    def update_movie_handler(self, data, method='PUT'):
        try:
            title = data.get('title')
            recommended = 1 if data.get('recommended') else 0
            review = data.get('review', '')
            ratings = data.get('ratings', '')
            image_filenames = data.get('image_filenames', '')
            original_images = json.loads(data.get('original_images', '[]'))
            if not isinstance(original_images, list):
                original_images = []
            current_images = set(self.dependencies.parse_image_filenames(image_filenames))
            original_images_set = {
                filename
                for filename in (self.dependencies.normalize_upload_filename(filename) for filename in original_images)
                if filename
            }
            images_to_delete = original_images_set - current_images

            with self.dependencies.get_db_connection() as conn:
                cursor = conn.cursor()

                # 更新数据库记录
                cursor.execute("""
                    UPDATE movies 
                    SET recommended = %s, review = %s
                    WHERE title = %s
                """, (recommended, review, title))
                self.dependencies.replace_movie_images(cursor, title, image_filenames)
                self.dependencies.sync_movie_metadata(cursor, title, data.get('tags', ''), ratings)
                conn.commit()
                self.dependencies.delete_unreferenced_uploaded_images(cursor, images_to_delete)
    			
            return self.dependencies.jsonify({"message": "电影更新成功"}), 200

        except Exception as e:
            return self.dependencies.json_exception('Update movie', e, '电影更新失败')


    def search_movies_sql_handler(self, data):
        data = data or {}
        search_term = str(data.get('title') or '').strip()
        rating_dimension = str(data.get('rating_dimension') or '').strip()
        min_rating_raw = str(data.get('min_rating') or '').strip()
        recommended_raw = data.get('recommended')
        recommended_filter = '' if recommended_raw is None else str(recommended_raw).strip()
        selected_tag_names = self.dependencies.parse_tag_names(data.get('tags', ''))
        page = self.dependencies.parse_positive_int(data.get('page'), 1, 1)
        per_page = self.dependencies.parse_positive_int(data.get('per_page'), 10, 1, 100)

        if recommended_filter and recommended_filter not in ('0', '1'):
            return self.dependencies.json_error('Invalid recommended filter', 400)

        with self.dependencies.get_db_connection() as conn:
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
                tag_ids = self.dependencies.resolve_tag_ids(cursor, selected_tag_names)
                if len(tag_ids) != len(selected_tag_names):
                    return self.dependencies.jsonify({
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
                min_rating = self.dependencies.parse_positive_int(min_rating_raw, None, 1, 5)
                if min_rating is None:
                    return self.dependencies.json_error('Invalid minimum rating', 400)

            rating_dimension_id = None
            if rating_dimension:
                rating_dimension_id = self.dependencies.resolve_rating_dimension_id(cursor, rating_dimension)
                if rating_dimension_id is None:
                    return self.dependencies.jsonify({
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
            movies = self.dependencies.hydrate_movie_rows(cursor, cursor.fetchall())

            return self.dependencies.jsonify({
                "success": True,
                "data": movies,
                "pagination": {
                    "page": page,
                    "per_page": per_page,
                    "total": total,
                    "total_pages": total_pages
                }
            })

    def search_movies_handler(self, data, method='GET'):
        try:
            return self.search_movies_sql_handler(data)
        except Exception as e:
            return self.dependencies.json_exception('Search movies', e, '搜索失败')


    def delete_movie_handler(self, data, method='DELETE'):
        try:
            title = data.get('title')
            with self.dependencies.get_db_connection() as conn:
                cursor = conn.cursor(dictionary=True)
                
                # 首先检查电影是否存在
                cursor.execute("SELECT title FROM movies WHERE title = %s", (title,))
                if not cursor.fetchone():
                    return self.dependencies.jsonify({"success": False, "message": "电影名称不存在"}), 404
                
                image_files = self.dependencies.get_movie_image_filenames(cursor, title)

                # 删除数据库记录
                cursor.execute("DELETE FROM movie_tags WHERE movie_title = %s", (title,))
                cursor.execute("DELETE FROM movie_ratings WHERE movie_title = %s", (title,))
                cursor.execute("DELETE FROM movie_images WHERE movie_title = %s", (title,))
                cursor.execute("DELETE FROM movies WHERE title = %s", (title,))
                conn.commit()
                self.dependencies.delete_unreferenced_uploaded_images(cursor, image_files)
                
                return self.dependencies.jsonify({"success": True, "message": "电影删除成功"})

        except Exception as e:
            self.dependencies.log_exception('Delete movie', e)
            return self.dependencies.jsonify({"success": False, "message": "删除操作失败"}), 500

