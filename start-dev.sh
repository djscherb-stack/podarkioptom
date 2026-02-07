#!/bin/bash
# Перезапустить backend и открыть аналитику с автовходом под админом (локальная версия)

cd "$(dirname "$0")"

echo "=== Запуск аналитики ==="

# 1. Venv
if [ ! -d venv ]; then
  echo "Создаю venv..."
  python3 -m venv venv
fi
source venv/bin/activate
pip install -q -r backend/requirements.txt 2>/dev/null

# 3. Сборка frontend
echo "1. Сборка frontend..."
(cd frontend && npm run build 2>/dev/null) || true

# 4. Перезапуск backend
echo "2. Перезапуск backend..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 2

cd backend
nohup uvicorn app:app --host 0.0.0.0 --port 8000 > /tmp/analytics-server.log 2>&1 &
BACKEND_PID=$!
cd ..

# 5. Ждём запуска
echo "3. Ожидание запуска сервера..."
for i in {1..15}; do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/ 2>/dev/null | grep -qE "200|301|302"; then
    echo "   Сервер готов."
    break
  fi
  sleep 1
done

# 6. Открыть браузер с автовходом (минуя авторизацию), сразу на страницу Админ
echo "4. Открываю страницу аналитики (автовход под админом)..."
URL="http://localhost:8000/api/dev-auto-login?next=/admin"
if command -v open >/dev/null 2>&1; then
  open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"
elif command -v start >/dev/null 2>&1; then
  start "$URL"
else
  echo "   Откройте вручную: $URL"
fi

echo ""
echo "=== Готово ==="
echo "Аналитика: http://localhost:8000"
echo "Сервер в фоне (PID $BACKEND_PID). Логи: /tmp/analytics-server.log"
echo "Остановить: kill $BACKEND_PID"
echo ""
