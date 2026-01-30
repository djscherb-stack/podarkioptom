#!/bin/bash
cd "$(dirname "$0")"
source venv/bin/activate 2>/dev/null || . venv/bin/activate

# Остановить старый процесс на порту 8000
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
sleep 1

echo "Запуск сервера..."
cd backend && uvicorn app:app --host 0.0.0.0 --port 8000 &
UVICORN_PID=$!

trap "kill $UVICORN_PID 2>/dev/null; exit" INT TERM

# Ждём, пока сервер поднимется
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -s http://localhost:8000/api/months >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "Открываю браузер..."
open http://localhost:8000 2>/dev/null || xdg-open http://localhost:8000 2>/dev/null || start http://localhost:8000 2>/dev/null

echo "Сервер: http://localhost:8000 — остановить: Ctrl+C"
wait $UVICORN_PID
