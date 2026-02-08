"""Лог запусков синхронизации с Google Drive — для просмотра в админке."""

import json
import os
from datetime import datetime
from pathlib import Path

import database as db

SYNC_LOG_FILE = "sync_log.json"
MAX_ENTRIES = 100


def _get_log_path() -> Path:
    return db.get_data_dir() / SYNC_LOG_FILE


def _load_log() -> list:
    path = _get_log_path()
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_log(entries: list):
    db.ensure_data_dir()
    path = _get_log_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(entries[-MAX_ENTRIES:], f, ensure_ascii=False, indent=0)


def log_sync(source: str, result: dict):
    """Записать результат синхронизации. source: 'cron' | 'admin'."""
    entries = _load_log()
    entry = {
        "at": datetime.now().isoformat(),
        "source": source,
        "ok": result.get("ok", False),
        "error": result.get("error"),
        "downloaded": result.get("downloaded", []),
        "errors": result.get("errors", []),
        "refreshed": bool(result.get("downloaded")),
    }
    entries.append(entry)
    _save_log(entries)


def get_sync_log() -> list:
    """Получить последние записи лога (новые сверху)."""
    entries = _load_log()
    return list(reversed(entries))
