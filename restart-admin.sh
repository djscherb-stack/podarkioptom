#!/bin/bash
# Перезапуск проекта и вход под админом (localhost)
cd "$(dirname "$0")"

echo "=== Перезагрузка проекта и вход под админом ==="

# Останавливаем старые процессы
echo "Останавливаю backend и frontend..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
lsof -ti:5174 | xargs kill -9 2>/dev/null || true
sleep 2

# Venv и зависимости
if [ ! -d venv ]; then
  echo "Создаю venv..."
  python3 -m venv venv
fi
source venv/bin/activate
pip install -q -r backend/requirements.txt 2>/dev/null

# Сборка frontend для раздачи с backend (если ещё не собран)
if [ ! -f frontend/dist/index.html ]; then
  echo "Сборка frontend..."
  (cd frontend && npm run build)
fi

# Запуск backend
echo "Запускаю backend на http://localhost:8000 ..."
cd backend && uvicorn app:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# Ждём, пока backend поднимется
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/dev-auto-login 2>/dev/null | grep -q '302\|200'; then
    echo "Backend готов."
    break
  fi
  sleep 1
done

# Открываем в браузере автовход под админом (редирект на / с cookie)
LOGIN_URL="http://127.0.0.1:8000/api/dev-auto-login"
echo ""
echo "Открываю браузер: вход под админом..."
(open "$LOGIN_URL" 2>/dev/null || xdg-open "$LOGIN_URL" 2>/dev/null || start "$LOGIN_URL" 2>/dev/null) || true

echo ""
echo "Готово. Сайт: http://localhost:8000 (вы вошли как admin)."
echo "Остановить backend: Ctrl+C или выполнить: kill $BACKEND_PID"
echo ""
wait $BACKEND_PID
