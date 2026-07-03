import os
from urllib.parse import quote


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
