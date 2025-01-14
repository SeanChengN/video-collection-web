import os
from flask import Flask, render_template, request, jsonify
import mysql.connector
from contextlib import contextmanager
from flask_compress import Compress
#import logging

app = Flask(__name__)
Compress(app)

# 配置压缩选项
app.config['COMPRESS_MIMETYPES'] = [
    'text/html',
    'text/css',
    'text/xml',
    'application/json',
    'application/javascript',
    'application/x-javascript'
]
app.config['COMPRESS_LEVEL'] = 6
app.config['COMPRESS_MIN_SIZE'] = 500

# 配置日志
#logging.basicConfig(
#    level=logging.INFO,
#    format='%(asctime)s - %(levelname)s - %(message)s'
#)

# 数据库连接配置，从环境变量中读取
DB_CONFIG = {
    "host": os.environ["DB_HOST"],
    "user": os.environ["DB_USER"], 
    "password": os.environ["DB_PASSWORD"],
    "database": os.environ["DB_DATABASE"]
}

@contextmanager
def get_db_connection():
    conn = mysql.connector.connect(**DB_CONFIG)
    try:
        yield conn
    finally:
        if conn.is_connected():
            conn.close()

# 初始化数据库
def init_db():
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # 创建movies表 - tags字段和ratings字段存储逗号分隔的ID和值
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS movies (
                    title VARCHAR(255) PRIMARY KEY,
                    recommended BOOLEAN,
                    review TEXT,
                    tags VARCHAR(255),
					ratings VARCHAR(255),
                    added_date DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # 创建tags表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS tags (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(50) UNIQUE
                )
            """)
            # 创建ratings_dimensions表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ratings_dimensions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(50) UNIQUE
                )
            """)
            
            # 预设标签
            default_tags = [
                "花容月貌", "其貌不扬", "婀娜多姿", "丑态百出", 
                "肤如凝脂", "肌无完肤", "演技投入", "形如死鱼",
                "开除摄像", "蒙头盖面", "马赛克"
            ]
            
            # 预设评分维度
            default_dimensions = [
                "颜值", "身材", "皮肤", "激情", "摄影"
            ]
            
            # 插入预设标签
            for tag in default_tags:
                try:
                    cursor.execute("INSERT INTO tags (name) VALUES (%s)", (tag,))
                except mysql.connector.Error as err:
                    if err.errno != 1062:  # 忽略重复键错误
                        raise
            
            # 插入预设评分维度
            for dimension in default_dimensions:
                try:
                    cursor.execute("INSERT INTO ratings_dimensions (name) VALUES (%s)", (dimension,))
                except mysql.connector.Error as err:
                    if err.errno != 1062:  # 忽略重复键错误
                        raise
                        
            conn.commit()
            return True
    except Exception as e:
        print(f"初始化数据库失败: {str(e)}")
        return False

@app.route("/")
def index():
    return render_template("index.html")  # 确保 index.html 存在于 templates 文件夹中

@app.route('/api/movies', methods=['POST'])
def add_movie():
    try:
        data = request.get_json()
        title = data.get('title')
        recommended = data.get('recommended')
        review = data.get('review')
        tag_names = data.get('tags', '').split(',') # 获取标签名称列表
        ratings = data.get('ratings', '')

        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # 获取标签名称对应的ID
            tag_ids = []
            for tag_name in tag_names:
                if tag_name.strip():
                    cursor.execute("SELECT id FROM tags WHERE name = %s", (tag_name.strip(),))
                    result = cursor.fetchone()
                    if result:
                        tag_ids.append(str(result[0]))
            
            # 将标签ID用逗号连接
            tags = ','.join(tag_ids)

            cursor.execute("""
                INSERT INTO movies (title, recommended, review, tags, ratings)
                VALUES (%s, %s, %s, %s, %s)
            """, (title, recommended, review, tags, ratings))
            conn.commit()
        return jsonify({"message": "电影添加成功"}), 200
    except mysql.connector.Error as err:
        return jsonify({"error": str(err)}), 500

@app.route('/api/movies/<title>', methods=['PUT'])
def update_movie(title):
    try:
        data = request.get_json()
        title = data.get('title')
        recommended = data.get('recommended')
        review = data.get('review')
        tag_names = data.get('tags', '').split(',')
        ratings = data.get('ratings', '')

        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # 获取标签名称对应的ID
            tag_ids = []
            for tag_name in tag_names:
                if tag_name.strip():
                    cursor.execute("SELECT id FROM tags WHERE name = %s", (tag_name.strip(),))
                    result = cursor.fetchone()
                    if result:
                        tag_ids.append(str(result[0]))
            
            # 将标签ID用逗号连接
            tags = ','.join(tag_ids)
			
            cursor.execute("""
                UPDATE movies 
                SET recommended = %s, review = %s, tags = %s, ratings = %s
                WHERE title = %s
            """, (recommended, review, tags, ratings, title))
            
            conn.commit()			
			
        return jsonify({"message": "电影更新成功"}), 200
    except mysql.connector.Error as err:
        return jsonify({"error": str(err)}), 500

@app.route("/get_ratings_dimensions", methods=["GET"])
def get_ratings_dimensions():
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT * FROM ratings_dimensions ORDER BY id")
            dimensions = cursor.fetchall()
            return jsonify({"success": True, "dimensions": dimensions})
    except Exception as e:
        return jsonify({"success": False, "message": f"获取评分维度失败: {str(e)}"}), 500

@app.route("/search", methods=["GET"])
def search():
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            
            # 获取所有标签数据
            cursor.execute("SELECT * FROM tags")
            all_tags = {str(tag['id']): tag['name'] for tag in cursor.fetchall()}
            
            # 获取所有评分维度
            cursor.execute("SELECT * FROM ratings_dimensions")
            all_dimensions = {str(dim['id']): dim['name'] for dim in cursor.fetchall()}
            
            # 获取搜索参数
            search_term = request.args.get('title', '').strip()
            rating_dimension = request.args.get('rating_dimension', '').strip()
            min_rating = request.args.get('min_rating', '').strip()
            
            # 构建基础查询
            query = "SELECT * FROM movies"
            params = []
            where_clauses = []			
			
            if search_term:
                where_clauses.append("(title LIKE %s OR review LIKE %s)")
                params.extend([f'%{search_term}%', f'%{search_term}%'])
            
            if where_clauses:
                query += " WHERE " + " AND ".join(where_clauses)
            
            query += " ORDER BY added_date DESC"			
			
            cursor.execute(query, params)
            movies = cursor.fetchall()
            
            # 处理每部电影的数据
            for movie in movies:
                # 处理标签显示
                movie['tag_names'] = ', '.join(all_tags.get(tag_id, '') 
                    for tag_id in (movie['tags'].split(',') if movie['tags'] else []))
                
                # 处理评分显示
                if movie['ratings']:
                    movie['ratings_display'] = {
                        all_dimensions.get(dim_id, ''): int(rating)
                        for dim_id, rating in (pair.split(':') 
                        for pair in movie['ratings'].split(',') if ':' in pair)
                    }
                else:
                    movie['ratings_display'] = {}
                
                # 格式化日期显示
                movie['formatted_added_date'] = movie['added_date'].strftime('%Y-%m-%d %H:%M:%S')
            
            return jsonify({"success": True, "data": movies})
            
    except Exception as e:
        return jsonify({"success": False, "message": f"搜索失败: {str(e)}"}), 500

@app.route("/get_tags", methods=["GET"])
def get_tags():
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT id, name FROM tags")
            tags = [tag['name'] for tag in cursor.fetchall()]
            return jsonify({"success": True, "data": tags})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

# 从环境变量中读取参数
@app.route('/get_services_config')
def get_services_config():
    return jsonify({
        'emby_api_key': os.environ['EMBY_API_KEY'],
        'emby_server_url': os.environ['EMBY_SERVER_URL'],
        'jackett_url': os.environ['JACKETT_URL'],
        'thunder_url': os.environ['THUNDER_URL']
    })

# 查重核对相关代码
@app.route("/check_duplicates", methods=["POST"])
def check_duplicates():
    try:
        data = request.json
        titles = data.get('titles', [])
        
        #logging.info(f"收到待核对的电影列表: {titles}")
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            placeholders = ','.join(['%s'] * len(titles))
            query = f"SELECT title FROM movies WHERE title IN ({placeholders})"
            
            #logging.info(f"执行的SQL查询: {query}")
            #logging.info(f"查询参数: {titles}")
            
            cursor.execute(query, titles)
            duplicates = [row[0] for row in cursor.fetchall()]
            
            #logging.info(f"数据库中匹配到的电影: {duplicates}")
            
            return jsonify({
                "success": True,
                "duplicates": duplicates
            })
    except Exception as e:
        #logging.error(f"查重核对出错: {str(e)}")
        return jsonify({"success": False, "message": str(e)}), 500


if __name__ == "__main__":
    if init_db():
        app.run(debug=True, host='0.0.0.0', port=5000) #  指定 host='0.0.0.0' 使 Flask 监听所有网络接口
    else:
        print("数据库初始化失败，程序退出")
