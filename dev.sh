#!/bin/bash
# Быстрый запуск для разработки: frontend с автоперезагрузкой + backend
cd "$(dirname "$0")"

# Убить старые процессы
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 1

if [ -d venv ]; then
  source venv/bin/activate 2>/dev/null || . venv/bin/activate
else
  echo "Создаю venv..."
  python3 -m venv venv && source venv/bin/activate
  pip install -q -r backend/requirements.txt
fi

echo "1. Запуск backend (порт 8000)..."
cd backend && uvicorn app:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

sleep 2

echo "2. Запуск frontend с автоперезагрузкой (порт 5173)..."
cd ../frontend && npm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM

URL="http://localhost:5173"
echo ""
echo "Готово! Открываю $URL"
sleep 3
(open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || start "$URL" 2>/dev/null) || true

echo ""
echo "Frontend: $URL (изменения подхватываются мгновенно)"
echo "Если браузер не открылся — откройте вручную: $URL"
echo "Остановить: Ctrl+C"
wait
