#!/bin/bash
# Перезапуск приложения + автовход под админом (только localhost)
cd "$(dirname "$0")"

echo "=== Перезапуск аналитики + автовход ==="

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

# Убить старые процессы на порту 8000
echo "Останавливаю старый сервер..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
sleep 2

# Запуск в фоне
echo "Запускаю сервер..."
cd backend
nohup uvicorn app:app --host 0.0.0.0 --port 8000 > /tmp/analytics-server.log 2>&1 &
SERVER_PID=$!
cd ..

# Ждём готовности
echo "Ожидание запуска..."
for i in {1..15}; do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/ 2>/dev/null | grep -q "200\|301\|302"; then
    echo "Сервер готов."
    break
  fi
  sleep 1
done

# Открыть браузер с автовходом
echo "Открываю браузер (автовход под админом)..."
URL="http://localhost:8000/api/dev-auto-login"
if command -v open >/dev/null 2>&1; then
  open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"
else
  echo "Откройте вручную: $URL"
fi

echo ""
echo "Сервер работает в фоне (PID $SERVER_PID). Логи: /tmp/analytics-server.log"
echo "Для остановки: kill $SERVER_PID"
echo ""
