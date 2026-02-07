#!/bin/bash
# Запуск аналитики локально: сразу открывается главная страница, без формы входа (автовход под admin).
cd "$(dirname "$0")"

echo "=== Запуск аналитики (без авторизации) ==="

# Останавливаем старые процессы
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
lsof -ti:5174 | xargs kill -9 2>/dev/null || true
sleep 2

# Venv
if [ ! -d venv ]; then
  echo "Создаю venv..."
  python3 -m venv venv
fi
source venv/bin/activate
pip install -q -r backend/requirements.txt 2>/dev/null

# Сборка frontend, если ещё нет
if [ ! -f frontend/dist/index.html ]; then
  echo "Сборка frontend..."
  (cd frontend && npm run build)
fi

# Запуск backend
echo "Запускаю сервер..."
cd backend && uvicorn app:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# Ждём готовности
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/dev-auto-login 2>/dev/null | grep -q '302\|200'; then
    break
  fi
  sleep 1
done

# Открыть в браузере сразу в аналитике (автовход, редирект на главную)
URL="http://127.0.0.1:8000/api/dev-auto-login"
echo ""
echo "Открываю аналитику в браузере (минуя форму входа)..."
(open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || start "$URL" 2>/dev/null) || true

echo ""
echo "Готово. Аналитика: http://localhost:8000"
echo "Остановить: Ctrl+C"
echo ""
wait $BACKEND_PID
