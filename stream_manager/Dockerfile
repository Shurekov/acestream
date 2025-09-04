# /home/seva/acestream/stream_manager/Dockerfile

# Используем официальный образ Python
FROM python:3.9-slim

# Установка зависимостей системы, включая ffmpeg (для ffprobe)
# Обновляем список пакетов и устанавливаем ffmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Установка рабочей директории
WORKDIR /app

# Копируем файл зависимостей
COPY requirements.txt .

# Устанавливаем зависимости Python
RUN pip install --no-cache-dir -r requirements.txt

# Копируем остальной код приложения
COPY . .

# Открываем порт (если не указан в docker-compose)
EXPOSE 5000

# Запускаем приложение
CMD ["python", "app.py"]