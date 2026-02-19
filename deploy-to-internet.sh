#!/bin/bash
# Выгрузка кода в интернет: коммит + push в GitHub → Render подхватит и задеплоит (если включён Auto-Deploy)
# Запуск: ./deploy-to-internet.sh
# Опционально: ./deploy-to-internet.sh "ваше сообщение коммита"
set -e
cd "$(dirname "$0")"

MSG="${1:-Деплой: обновление аналитики}"

echo "=== Выгрузка в интернет ==="
echo ""

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Ошибка: это не git-репозиторий. Выполните: git init && git remote add origin URL"
  exit 1
fi

echo "Добавляю изменения..."
git add -A
if git diff --cached --quiet; then
  echo "Нет изменений для коммита."
  exit 0
fi

echo "Коммит: $MSG"
git commit -m "$MSG"

echo "Пуш в origin main..."
git push origin main

echo ""
echo "=============================================="
echo "  Код выгружен. Render задеплоит при Auto-Deploy."
echo "  Данные (Excel) на сервер не попадают из git —"
echo "  они подтягиваются синхронизацией с Google Drive"
echo "  или загрузкой по API. После деплоя при необходимости:"
echo "  curl -H \"X-Upload-Token: ВАШ_ТОКЕН\" https://ВАШ_САЙТ.onrender.com/api/sync-from-gdrive"
echo "=============================================="
