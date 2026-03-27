"""Синхронизация графиков и табелей из Google Sheets."""

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Env-переменные для каждого производства:
# GSHEETS_SCHEDULE_TEA=<spreadsheet_id>|<sheet_name>
# GSHEETS_SCHEDULE_ENGRAVING=<spreadsheet_id>|<sheet_name>
# GSHEETS_SCHEDULE_LUMINARC=<spreadsheet_id>|<sheet_name>

PRODUCTION_ENV_KEYS = {
    "tea":       "GSHEETS_SCHEDULE_TEA",
    "engraving": "GSHEETS_SCHEDULE_ENGRAVING",
    "luminarc":  "GSHEETS_SCHEDULE_LUMINARC",
}


def _parse_env(env_key: str) -> Optional[tuple[str, str]]:
    """Разбирает 'spreadsheet_id|sheet_name' из env. Возвращает (id, name) или None."""
    val = os.environ.get(env_key, "").strip()
    if not val:
        return None
    if "|" in val:
        parts = val.split("|", 1)
        return parts[0].strip(), parts[1].strip()
    # Только ID без имени листа — берём первый лист
    return val, None


def _read_sheet(service, spreadsheet_id: str, sheet_name: Optional[str]) -> list[list[str]]:
    """Читает данные листа. Возвращает список строк (каждая строка — список ячеек)."""
    range_name = sheet_name if sheet_name else "Sheet1"
    result = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=range_name)
        .execute()
    )
    rows = result.get("values", [])
    return rows


def _rows_to_tsv(rows: list[list[str]]) -> str:
    """Конвертирует строки из Sheets API в TSV (как при копировании из браузера)."""
    lines = []
    for row in rows:
        lines.append("\t".join(str(cell) for cell in row))
    return "\n".join(lines)


def sync_schedules_from_gsheets(
    credentials_json: str,
    year: int,
    month: int,
    productions: Optional[list[str]] = None,
) -> dict:
    """
    Синхронизирует графики/табели из Google Sheets для указанных производств.
    Использует уже существующий import_combined_from_tsv() из workforce.py.

    Возвращает {'ok': True, 'synced': [...], 'errors': [...]}.
    """
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError:
        return {"ok": False, "error": "google-api-python-client не установлен", "synced": [], "errors": []}

    try:
        creds_dict = json.loads(credentials_json)
        credentials = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
        )
        service = build("sheets", "v4", credentials=credentials, cache_discovery=False)
    except Exception as e:
        return {"ok": False, "error": str(e), "synced": [], "errors": []}

    import workforce as wf

    if productions is None:
        productions = list(PRODUCTION_ENV_KEYS.keys())

    result = {"ok": True, "synced": [], "errors": []}

    for prod in productions:
        env_key = PRODUCTION_ENV_KEYS.get(prod)
        if not env_key:
            continue
        parsed = _parse_env(env_key)
        if not parsed:
            logger.info("gsheets_sync: %s не настроен (нет env %s)", prod, env_key)
            continue

        spreadsheet_id, sheet_name = parsed
        try:
            rows = _read_sheet(service, spreadsheet_id, sheet_name)
        except Exception as e:
            msg = f"{prod}: ошибка чтения таблицы — {e}"
            result["errors"].append(msg)
            logger.warning("gsheets_sync: %s", msg)
            continue

        if not rows:
            result["errors"].append(f"{prod}: таблица пуста")
            continue

        tsv = _rows_to_tsv(rows)

        try:
            schedule, timesheet = wf.import_combined_from_tsv(prod, year, month, tsv)
        except Exception as e:
            msg = f"{prod}: ошибка парсинга — {e}"
            result["errors"].append(msg)
            logger.warning("gsheets_sync: %s", msg)
            continue

        if schedule is None:
            result["errors"].append(f"{prod}: не удалось распознать формат таблицы")
            continue

        try:
            wf.save_schedule(prod, year, month, schedule)
            if timesheet:
                wf.save_timesheet(prod, year, month, timesheet)
            wf.merge_employees_from_schedule(prod, schedule)
            emp_count = len(schedule.get("employees", []))
            result["synced"].append({
                "production": prod,
                "employees": emp_count,
                "sheet": sheet_name or "первый лист",
                "at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            })
            logger.info("gsheets_sync: %s — импортировано %d сотрудников", prod, emp_count)
        except Exception as e:
            msg = f"{prod}: ошибка сохранения — {e}"
            result["errors"].append(msg)
            logger.warning("gsheets_sync: %s", msg)

    if result["errors"] and not result["synced"]:
        result["ok"] = False

    return result
