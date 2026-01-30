# Сборка frontend
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Production
FROM python:3.11-slim
WORKDIR /app

# Зависимости Python
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Код backend
COPY backend/ ./backend/

# Собранный frontend
COPY --from=frontend /app/frontend/dist ./frontend/dist

# Папка data и весь проект (для Excel из любой папки)
RUN mkdir -p /app/data
COPY . ./workspace/

ENV EXTRA_DATA_DIR=/app/workspace

ENV PYTHONPATH=/app
EXPOSE 8000

CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
