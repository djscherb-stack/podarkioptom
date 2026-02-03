#!/bin/bash
# Простой локальный запуск — не закрывайте это окно!
cd "$(dirname "$0")"

echo "=== Локальный запуск аналитики ==="

# Venv
if [ ! -d venv ]; then
  echo "Создаю venv..."
  python3 -m venv venv
fi
source venv/bin/activate
pip install -q -r backend/requirements.txt 2>/dev/null

# Frontend
if [ ! -f frontend/dist/index.html ]; then
  echo "Сборка frontend..."
  (cd frontend && npm run build)
fi

# Убить старые
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
sleep 1

echo ""
echo "Запускаю сервер на http://localhost:8000"
echo "НЕ ЗАКРЫВАЙТЕ это окно — сервер должен работать!"
echo ""
echo "Откройте в браузере: http://localhost:8000"
echo ""

cd backend
exec uvicorn app:app --host 0.0.0.0 --port 8000
