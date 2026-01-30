#!/bin/bash
# Быстрый запуск для разработки: frontend с автоперезагрузкой + backend
cd "$(dirname "$0")"

# Убить старые процессы
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 1

source venv/bin/activate 2>/dev/null || . venv/bin/activate

echo "1. Запуск backend (порт 8000)..."
cd backend && uvicorn app:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

sleep 2

echo "2. Запуск frontend с автоперезагрузкой (порт 5173)..."
cd ../frontend && npm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM

echo ""
echo "Готово! Открываю http://localhost:5173"
sleep 2
open http://localhost:5173 2>/dev/null || xdg-open http://localhost:5173 2>/dev/null || start http://localhost:5173 2>/dev/null

echo ""
echo "Frontend: http://localhost:5173 (изменения подхватываются мгновенно)"
echo "Остановить: Ctrl+C"
wait
