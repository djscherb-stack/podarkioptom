"""Уведомления в Telegram при обновлении данных о производстве."""

import logging
import os
from datetime import date
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

logger = logging.getLogger(__name__)

# Главные подразделения для сводки (ключевые показатели по производствам)
MAIN_DEPTS = {
    "ЧАЙ": "Сборочный цех Елино",
    "ГРАВИРОВКА": "Сборочный цех Елино Гравировка",
    "ЛЮМИНАРК": "Сборочный цех Люминарк",
}


def _month_name(month: int) -> str:
    names = ["", "янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
    return names[month] if 1 <= month <= 12 else str(month)


def _format_value(dept: dict, unit_suffix: str = "") -> str:
    """Форматирует значение блока: total или total_units + единица."""
    unit = dept.get("unit", "шт")
    total_units = dept.get("total_units")
    if total_units is not None:
        return f"{int(total_units)} {unit}{unit_suffix}"
    total = dept.get("total", 0)
    if unit == "кг":
        return f"{total} кг{unit_suffix}"
    return f"{int(total)} {unit}{unit_suffix}"


def _extract_main_totals(productions: dict) -> list[tuple[str, str]]:
    """Из статистики по производствам извлекает главные показатели (сборочные цеха)."""
    lines = []
    for prod_name, dept_name in MAIN_DEPTS.items():
        prod_data = productions.get(prod_name, {})
        for d in prod_data.get("departments", []):
            if d.get("name") == dept_name:
                lines.append((prod_name, _format_value(d)))
                break
        else:
            lines.append((prod_name, "—"))
    return lines


def build_summary_text(trigger: str = "данные", downloaded_files: Optional[list] = None) -> str:
    """
    Собирает краткий текст с ключевыми показателями: последний день с данными и текущий месяц.
    """
    import database as db

    df = db.get_df()
    if df is None or df.empty:
        return "📊 Обновление данных.\nДанных пока нет."

    last_date = df["date_only"].max()
    if hasattr(last_date, "isoformat"):
        last_date_str = last_date.isoformat()
    else:
        last_date_str = str(last_date)

    day_stats = db.get_daily_stats(last_date)
    productions_day = day_stats.get("productions", {})

    try:
        year_month = (last_date.year, last_date.month)
    except AttributeError:
        year_month = (date.today().year, date.today().month)

    month_stats = db.get_monthly_stats(year_month[0], year_month[1])
    productions_month = month_stats.get("productions", {})

    day_lines = _extract_main_totals(productions_day)
    month_lines = _extract_main_totals(productions_month)

    parts = ["📊 Данные о производстве обновлены"]

    if downloaded_files:
        parts.append(f"Загружено файлов: {len(downloaded_files)}")
        for f in downloaded_files[:3]:
            name = f.get("name", f.get("saved_as", ""))
            parts.append(f"  • {name}")
        if len(downloaded_files) > 3:
            parts.append(f"  … и ещё {len(downloaded_files) - 3}")

    parts.append("")
    parts.append(f"📅 За {last_date_str}:")
    for name, val in day_lines:
        parts.append(f"  {name}: {val}")

    parts.append("")
    month_label = f"{_month_name(year_month[1])} {year_month[0]}"
    parts.append(f"📆 Месяц ({month_label}):")
    for name, val in month_lines:
        parts.append(f"  {name}: {val}")

    return "\n".join(parts)


def send_telegram_message(text: str) -> bool:
    """
    Отправляет сообщение в Telegram через Bot API.
    Требуются переменные окружения: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
    Возвращает True при успехе.
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        logger.debug("Telegram: TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы, пропуск")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    body = {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
    data = urlencode(body).encode("utf-8")

    try:
        req = Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        with urlopen(req, timeout=10) as resp:
            if resp.status != 200:
                logger.warning("Telegram API status %s: %s", resp.status, resp.read())
                return False
            return True
    except (HTTPError, URLError, OSError) as e:
        logger.warning("Telegram send failed: %s", e)
        return False


def notify_data_updated(
    trigger: str = "данные",
    downloaded: Optional[list] = None,
) -> bool:
    """
    Строит сводку по производству и отправляет её в Telegram.
    Вызывать после refresh_data() при загрузке новых файлов или ручной загрузке.
    trigger: "upload" | "gdrive" (для логов).
    downloaded: список {"name", "saved_as"} при sync из GDrive.
    """
    try:
        text = build_summary_text(trigger=trigger, downloaded_files=downloaded)
        ok = send_telegram_message(text)
        if ok:
            logger.info("Telegram notification sent (trigger=%s)", trigger)
        return ok
    except Exception as e:
        logger.exception("Telegram notify failed: %s", e)
        return False
