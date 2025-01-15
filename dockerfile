FROM python:3.9-slim-buster

# 镜像信息
LABEL org.opencontainers.image.source="https://github.com/SeanChengN/video-collection-web" \
      org.opencontainers.image.description="Video Collection Web Application" \
      org.opencontainers.image.licenses="GPL-3.0"

# 设置 Python 环境变量
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .

# 安装依赖，同时清理缓存减小镜像大小
RUN pip install --no-cache-dir -r requirements.txt && \
    rm -rf /root/.cache/pip/* && \
    rm -rf /tmp/*

COPY . .

# 暴露应用端口
EXPOSE 5000

CMD ["python", "app.py"]
