#!/bin/bash
# Запуск сайта локально: backend (API) + frontend (Vite). Открыть в браузере: http://localhost:5173
# Остановить: Ctrl+C
cd "$(dirname "$0")"

echo "=== Запуск сайта локально ==="
echo ""

# Освободить порты
echo "Освобождаю порты 8000 и 5173..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 1

# Backend: venv и зависимости
if [ ! -d venv ]; then
  echo "Создаю venv..."
  python3 -m venv venv
fi
source venv/bin/activate
echo "Проверяю зависимости backend..."
pip install -q -r backend/requirements.txt 2>/dev/null || pip install -r backend/requirements.txt

# Frontend: node_modules
if [ ! -d frontend/node_modules ]; then
  echo "Устанавливаю зависимости frontend..."
  (cd frontend && npm install)
fi

# Запуск backend
echo "Запускаю backend (порт 8000)..."
(cd backend && uvicorn app:app --host 0.0.0.0 --port 8000) &
BACKEND_PID=$!

sleep 2

# Запуск frontend (горячая перезагрузка)
echo "Запускаю frontend (порт 5173)..."
(cd frontend && npm run dev) &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM

# Открыть в браузере через пару секунд
(
  sleep 4
  echo ""
  echo "Открываю браузер..."
  open "http://localhost:5173" 2>/dev/null || xdg-open "http://localhost:5173" 2>/dev/null || start "http://localhost:5173" 2>/dev/null || true
) &

echo ""
echo "=============================================="
echo "  Сайт: http://localhost:5173"
echo "  (API: http://localhost:8000)"
echo "  Остановить: Ctrl+C"
echo "=============================================="
echo ""

wait
