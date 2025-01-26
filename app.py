import os #文件操作
import io #处理图像数据流
import mysql.connector #数据库连接
import time #时间处理
import uuid #UUID生成
import json #JSON处理
from flask import Flask, render_template, request, jsonify, send_from_directory #Flask框架
from contextlib import contextmanager #上下文管理器
from flask_compress import Compress #压缩代码
from PIL import Image #图像处理
#import logging

app = Flask(__name__)
Compress(app)

# 图片上传常量
UPLOAD_FOLDER = '/images'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

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
                    image_filename TEXT,
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
                "精品", "剧情", "写实", "激烈", 
                "抽象", "情感", "蒙面"
            ]
            
            # 预设评分维度
            default_dimensions = [
                "颜值", "身材", "皮肤", "表演", "画面", "剧情"
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
        recommended = 1 if data.get('recommended') else 0
        review = data.get('review', '')
        tag_names = data.get('tags', '').split(',')
        ratings = data.get('ratings', '')
        image_filenames = data.get('image_filenames', '')

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
                INSERT INTO movies (title, recommended, review, tags, ratings, image_filename)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (title, recommended, review, tags, ratings, image_filenames))
            conn.commit()
        return jsonify({"message": "电影添加成功"}), 200
    except mysql.connector.Error as err:
        return jsonify({"error": str(err)}), 500

@app.route('/api/movies/<title>', methods=['PUT'])
def update_movie(title):
    try:
        data = request.get_json()
        title = data.get('title')
        recommended = 1 if data.get('recommended') else 0
        review = data.get('review', '')
        tag_names = data.get('tags', '').split(',')
        ratings = data.get('ratings', '')
        image_filenames = data.get('image_filenames', '')
        original_images = json.loads(data.get('original_images', '[]'))

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

            # 处理图片文件删除
            if original_images:
                current_images = set(image_filenames.split(',') if image_filenames else [])
                original_images_set = set(original_images)
                
                # 找出需要删除的图片
                images_to_delete = original_images_set - current_images
                
                # 删除不再使用的图片文件
                for filename in images_to_delete:
                    try:
                        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                        if os.path.exists(file_path):
                            os.remove(file_path)
                    except Exception as e:
                        print(f"删除图片文件失败: {filename}, 错误: {str(e)}")
            
            # 更新数据库记录
            cursor.execute("""
                UPDATE movies 
                SET recommended = %s, review = %s, tags = %s, ratings = %s, image_filename = %s
                WHERE title = %s
            """, (recommended, review, tags, ratings, image_filenames, title))

            conn.commit()
			
        return jsonify({"message": "电影更新成功"}), 200
    except mysql.connector.Error as err:
        return jsonify({"error": str(err)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/get_ratings_dimensions", methods=["GET"])
def get_ratings_dimensions():
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT * FROM ratings_dimensions ORDER BY id")
            dimensions = cursor.fetchall()
            return jsonify({"success": True, "dimensions": dimensions})
    except mysql.connector.Error as err:
        print(f"数据库错误: {str(err)}")
        return jsonify({"success": False, "message": str(err)}), 500
    except Exception as e:
        print(f"未知错误: {str(e)}")
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
    except mysql.connector.Error as err:
        print(f"数据库错误: {str(err)}")
        return jsonify({"success": False, "message": str(err)}), 500
    except Exception as e:
        print(f"未知错误: {str(e)}")
        return jsonify({"success": False, "message": "获取标签失败"}), 500

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

# 设置功能相关代码
@app.route("/add_tag", methods=["POST"])
def add_tag():
    try:
        data = request.get_json()
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
        return jsonify({"success": False, "message": str(err)}), 500

@app.route("/update_tag", methods=["POST"])
def update_tag():
    try:
        data = request.get_json()
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
        return jsonify({"success": False, "message": str(err)}), 500

@app.route("/add_rating_dimension", methods=["POST"])
def add_rating_dimension():
    try:
        data = request.get_json()
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
        return jsonify({"success": False, "message": str(err)}), 500

@app.route("/update_rating_dimension", methods=["POST"])
def update_rating_dimension():
    try:
        data = request.get_json()
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
        return jsonify({"success": False, "message": str(err)}), 500

@app.route("/api/movies/<title>", methods=["DELETE"])
def delete_movie(title):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            
            # 首先检查电影是否存在
            cursor.execute("SELECT title FROM movies WHERE title = %s", (title,))
            if not cursor.fetchone():
                return jsonify({"success": False, "message": "电影名称不存在"}), 404
            
            # 获取电影信息，包括图片文件名
            cursor.execute("SELECT image_filename FROM movies WHERE title = %s", (title,))
            movie = cursor.fetchone()
            
            # 删除关联的图片文件
            if movie['image_filename']:
                image_files = movie['image_filename'].split(',')
                for filename in image_files:
                    if filename.strip():
                        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename.strip())
                        if os.path.exists(file_path):
                            os.remove(file_path)

            # 删除数据库记录
            cursor.execute("DELETE FROM movies WHERE title = %s", (title,))
            conn.commit()
            
            return jsonify({"success": True, "message": "电影删除成功"})

    except mysql.connector.Error as err:
        print(f"数据库错误: {str(err)}")
        return jsonify({"success": False, "message": str(err)}), 500
    except Exception as e:
        print(f"未知错误: {str(e)}")
        return jsonify({"success": False, "message": "删除操作失败"}), 500

# 图片访问路由
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg'}
@app.route('/images/<path:filename>')
def serve_image(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# 图片文件验证
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def process_image(image_file):
    # 打开图片
    img = Image.open(image_file)
    
    # 计算等比例缩放尺寸,以720p为基准
    width, height = img.size
    target_height = 720
    # 计算缩放比例并得到新的宽度
    ratio = target_height / height
    new_width = int(width * ratio)
    
    # 等比例缩放到目标尺寸
    img = img.resize((new_width, target_height), Image.Resampling.LANCZOS)
    
    # 转换为WebP格式并压缩
    output = io.BytesIO()
    img.save(output, format='WebP', quality=85, optimize=True)
    return output.getvalue()

@app.route('/upload_image', methods=['POST'])
def upload_image():
    print("开始处理图片上传请求")
    if 'image' not in request.files:
        print("没有接收到文件")
        return jsonify({'success': False, 'message': '没有文件'})
        
    file = request.files['image']
 
    if file and allowed_file(file.filename):
        # 使用timestamp + uuid确保文件名唯一
        timestamp = int(time.time())
        unique_id = str(uuid.uuid4())[:8] 
        filename = f"{timestamp}_{unique_id}.webp"
        
        # 处理并保存图片
        try:
            processed_image = process_image(file)
            with open(os.path.join(UPLOAD_FOLDER, filename), 'wb') as f:
                f.write(processed_image)
            print(f"图片保存成功: {filename}")
            return jsonify({
                'success': True,
                'filename': filename
            })
        except Exception as e:
            print(f"图片处理失败: {str(e)}")
            return jsonify({'success': False, 'message': f'图片处理失败: {str(e)}'})

if __name__ == "__main__":
    if init_db():
        app.run(debug=True, host='0.0.0.0', port=5000) #  指定 host='0.0.0.0' 使 Flask 监听所有网络接口
    else:
        print("数据库初始化失败，程序退出")