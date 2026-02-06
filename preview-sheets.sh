#!/bin/bash
# Локальный запуск с темой Google Таблицы и автовходом (под админом)
# Запустите, чтобы посмотреть интерфейс перед выгрузкой в интернет

cd "$(dirname "$0")"

# Установить тему "sheets" для превью
mkdir -p data
echo '{"theme":"sheets"}' > data/theme.json
echo "Тема установлена: Google Таблицы"

# Убить старые процессы
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 1

# Venv
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

echo "2. Запуск frontend (порт 5173)..."
(cd frontend && npm run dev) &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM

# URL с автовходом — только для localhost
AUTO_LOGIN="http://localhost:5173/api/dev-auto-login"
echo ""
echo "Готово! Открываю браузер с автовходом..."
sleep 4
(open "$AUTO_LOGIN" 2>/dev/null || xdg-open "$AUTO_LOGIN" 2>/dev/null || start "$AUTO_LOGIN" 2>/dev/null) || true

echo ""
echo "Браузер: $AUTO_LOGIN (автовход под админом, тема Google Таблицы)"
echo "Если не открылось — откройте вручную: $AUTO_LOGIN"
echo "Остановить: Ctrl+C"
wait
