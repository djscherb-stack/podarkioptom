#!/bin/bash
# Локальный запуск «всё в одном»: сборка frontend, backend, открытие в браузере (без формы входа).
# Не закрывайте окно терминала — сервер работает, пока скрипт не завершён. Остановить: Ctrl+C.
cd "$(dirname "$0")"

set -e
echo "=== Локальный запуск аналитики ==="
echo ""

# 1. Остановить старые процессы
echo "1. Освобождаю порты 8000 и 5173..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 2

# 2. Venv и зависимости backend
if [ ! -d venv ]; then
  echo "2. Создаю venv..."
  python3 -m venv venv
fi
source venv/bin/activate
echo "   Устанавливаю зависимости backend..."
pip install -q -r backend/requirements.txt 2>/dev/null || pip install -r backend/requirements.txt

# 3. Frontend: установка и сборка (чтобы видеть актуальный интерфейс)
echo "3. Frontend..."
if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install)
fi
echo "   Сборка frontend (последние изменения)..."
(cd frontend && npm run build)

# 4. Запуск backend
echo "4. Запускаю сервер на http://localhost:8000 ..."
cd backend
uvicorn app:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# 5. Ждём готовности API
echo "5. Ожидание запуска сервера..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/dev-auto-login 2>/dev/null | grep -qE '302|200'; then
    echo "   Сервер готов."
    break
  fi
  sleep 1
done

# 6. Открыть в браузере (автовход, без формы логина)
URL="http://127.0.0.1:8000/api/dev-auto-login"
echo "6. Открываю аналитику в браузере..."
(open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || start "$URL" 2>/dev/null) || true

echo ""
echo "=== Готово ==="
echo "Аналитика: http://localhost:8000"
echo "Не закрывайте это окно. Остановить сервер: Ctrl+C"
echo ""
wait $BACKEND_PID
