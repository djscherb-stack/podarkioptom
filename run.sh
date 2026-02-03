#!/bin/bash
cd "$(dirname "$0")"

# Активация venv
if [ -d venv ]; then
  source venv/bin/activate 2>/dev/null || . venv/bin/activate
  pip install -q -r backend/requirements.txt 2>/dev/null || true
fi

# Сборка frontend, если ещё не собран
if [ ! -f frontend/dist/index.html ]; then
  echo "Сборка frontend..."
  (cd frontend && npm run build)
fi

# Остановить старый процесс на порту 8000
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
sleep 1

echo "Запуск сервера..."
cd backend
uvicorn app:app --host 0.0.0.0 --port 8000 &
UVICORN_PID=$!
cd ..

trap "kill $UVICORN_PID 2>/dev/null; exit" INT TERM

# Ждём, пока сервер поднимется
echo "Ожидание запуска..."
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/ 2>/dev/null | grep -q 200; then
    echo "Сервер запущен."
    break
  fi
  sleep 0.5
done

URL="http://localhost:8000"
echo ""
echo "Открываю браузер..."
(open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || start "$URL" 2>/dev/null) || true

echo ""
echo "Аналитика: $URL"
echo "Если браузер не открылся — откройте вручную: $URL"
echo "Остановить: Ctrl+C"
echo ""
wait $UVICORN_PID
