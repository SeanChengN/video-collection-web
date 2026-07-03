import mysql.connector


class ApiCatalogHandlersMixin:
    def get_ratings_dimensions_handler(self, data, method='GET'):
        try:
            with self.dependencies.get_db_connection() as conn:
                cursor = conn.cursor(dictionary=True)
                cursor.execute("SELECT * FROM ratings_dimensions ORDER BY id")
                dimensions = cursor.fetchall()
                return self.dependencies.jsonify({"success": True, "dimensions": dimensions})
        except Exception as e:
            return self.dependencies.json_exception('Get ratings dimensions', e)


    def get_tags_handler(self, data, method='GET'):
        try:
            with self.dependencies.get_db_connection() as conn:
                cursor = conn.cursor(dictionary=True)
                cursor.execute("SELECT id, name FROM tags")
                tags = [tag['name'] for tag in cursor.fetchall()]
                return self.dependencies.jsonify({"success": True, "data": tags})
        except Exception as e:
            return self.dependencies.json_exception('Get tags', e)

    # 从环境变量中读取参数

    def add_tag_handler(self, data, method='POST'):
        try:
            name = data.get('name', '').strip()
            
            if not name:
                return self.dependencies.jsonify({"success": False, "message": "标签名称不能为空"}), 400
                
            with self.dependencies.get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("INSERT INTO tags (name) VALUES (%s)", (name,))
                conn.commit()
                
            return self.dependencies.jsonify({"success": True})
        except mysql.connector.Error as err:
            if err.errno == 1062:  # 重复键错误
                return self.dependencies.jsonify({"success": False, "message": "标签名称已存在"}), 400
            self.dependencies.log_exception('Add tag', err)
            return self.dependencies.json_error('标签添加失败', 500)

    def update_tag_handler(self, data, method='POST'):
        try:
            old_name = data.get('old_name', '').strip()
            new_name = data.get('new_name', '').strip()
            
            if not old_name or not new_name:
                return self.dependencies.jsonify({"success": False, "message": "标签名称不能为空"}), 400
                
            with self.dependencies.get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE tags SET name = %s WHERE name = %s", (new_name, old_name))
                conn.commit()
                
            return self.dependencies.jsonify({"success": True})
        except mysql.connector.Error as err:
            if err.errno == 1062:  # 重复键错误
                return self.dependencies.jsonify({"success": False, "message": "标签名称已存在"}), 400
            self.dependencies.log_exception('Update tag', err)
            return self.dependencies.json_error('标签更新失败', 500)

    def delete_tag_handler(self, data, method='DELETE'):
        try:
            data = data or {}
            name = data.get('name', '').strip()
            preview = bool(data.get('preview'))
            confirm = bool(data.get('confirm'))

            if not name:
                return self.dependencies.jsonify({"success": False, "message": "标签名称不能为空"}), 400

            with self.dependencies.get_db_connection() as conn:
                cursor = conn.cursor(dictionary=True)
                cursor.execute("SELECT id, name FROM tags WHERE name = %s", (name,))
                tag = cursor.fetchone()
                if not tag:
                    return self.dependencies.jsonify({"success": False, "message": "标签不存在"}), 404

                cursor.execute(
                    "SELECT COUNT(DISTINCT movie_title) AS usage_count FROM movie_tags WHERE tag_id = %s",
                    (tag['id'],)
                )
                usage_count = cursor.fetchone()['usage_count']

                if preview or not confirm:
                    return self.dependencies.jsonify({
                        "success": True,
                        "exists": True,
                        "usage_count": usage_count,
                        "name": tag['name']
                    })

                cursor.execute("DELETE FROM movie_tags WHERE tag_id = %s", (tag['id'],))
                cursor.execute("DELETE FROM tags WHERE id = %s", (tag['id'],))
                conn.commit()

            return self.dependencies.jsonify({"success": True, "usage_count": usage_count})
        except Exception as e:
            return self.dependencies.json_exception('Delete tag', e, '标签删除失败')

    def add_rating_dimension_handler(self, data, method='POST'):
        try:
            name = data.get('name', '').strip()
            
            if not name:
                return self.dependencies.jsonify({"success": False, "message": "评分维度名称不能为空"}), 400
                
            with self.dependencies.get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("INSERT INTO ratings_dimensions (name) VALUES (%s)", (name,))
                conn.commit()
                
            return self.dependencies.jsonify({"success": True})
        except mysql.connector.Error as err:
            if err.errno == 1062:  # 重复键错误
                return self.dependencies.jsonify({"success": False, "message": "评分维度名称已存在"}), 400
            self.dependencies.log_exception('Add rating dimension', err)
            return self.dependencies.json_error('评分维度添加失败', 500)

    def update_rating_dimension_handler(self, data, method='POST'):
        try:
            old_name = data.get('old_name', '').strip()
            new_name = data.get('new_name', '').strip()
            
            if not old_name or not new_name:
                return self.dependencies.jsonify({"success": False, "message": "评分维度名称不能为空"}), 400
                
            with self.dependencies.get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE ratings_dimensions SET name = %s WHERE name = %s", (new_name, old_name))
                conn.commit()
                # 这里没有检查是否真的更新了记录
                
            return self.dependencies.jsonify({"success": True})
        except mysql.connector.Error as err:
            if err.errno == 1062:  # 重复键错误
                return self.dependencies.jsonify({"success": False, "message": "评分维度名称已存在"}), 400
            self.dependencies.log_exception('Update rating dimension', err)
            return self.dependencies.json_error('评分维度更新失败', 500)

    def delete_rating_dimension_handler(self, data, method='DELETE'):
        try:
            data = data or {}
            dimension_id = self.dependencies.parse_positive_int(data.get('id') or data.get('dimension_id'), None, 1)
            preview = bool(data.get('preview'))
            confirm = bool(data.get('confirm'))

            if dimension_id is None:
                return self.dependencies.jsonify({"success": False, "message": "评分维度无效"}), 400

            with self.dependencies.get_db_connection() as conn:
                cursor = conn.cursor(dictionary=True)
                cursor.execute("SELECT id, name FROM ratings_dimensions WHERE id = %s", (dimension_id,))
                dimension = cursor.fetchone()
                if not dimension:
                    return self.dependencies.jsonify({"success": False, "message": "评分维度不存在"}), 404

                cursor.execute(
                    "SELECT COUNT(DISTINCT movie_title) AS usage_count FROM movie_ratings WHERE dimension_id = %s",
                    (dimension_id,)
                )
                usage_count = cursor.fetchone()['usage_count']

                if preview or not confirm:
                    return self.dependencies.jsonify({
                        "success": True,
                        "exists": True,
                        "usage_count": usage_count,
                        "id": dimension['id'],
                        "name": dimension['name']
                    })

                cursor.execute("DELETE FROM movie_ratings WHERE dimension_id = %s", (dimension_id,))
                cursor.execute("DELETE FROM ratings_dimensions WHERE id = %s", (dimension_id,))
                conn.commit()

            return self.dependencies.jsonify({"success": True, "usage_count": usage_count})
        except Exception as e:
            return self.dependencies.json_exception('Delete rating dimension', e, '评分维度删除失败')

