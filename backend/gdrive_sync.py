"""Синхронизация отчётов из Google Drive в аналитику."""

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

import database as db

logger = logging.getLogger(__name__)

# Файл для учёта уже загруженных файлов (чтобы не дублировать)
PROCESSED_FILE = "processed_gdrive.json"

# Префиксы имён файлов → тип отчёта (пока только выпуск продукции; выработка сотрудников — позже)
PREFIX_PRODUCTION = "Выпуск продукции"


def _get_processed_path() -> Path:
    return db.get_data_dir() / PROCESSED_FILE


def _load_processed() -> dict:
    """Загрузить список обработанных file_id."""
    path = _get_processed_path()
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_processed(data: dict):
    db.ensure_data_dir()
    path = _get_processed_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=0)


def _list_files_recursive(service, folder_id: str, prefix_lower: str) -> list:
    """Собирает все подходящие файлы из папки и подпапок."""
    all_files = []
    to_visit = [folder_id]
    seen = set()

    while to_visit:
        fid = to_visit.pop()
        if fid in seen:
            continue
        seen.add(fid)
        query = f"'{fid}' in parents and trashed = false"
        try:
            response = (
                service.files()
                .list(
                    q=query,
                    fields="files(id, name, mimeType, modifiedTime)",
                    pageSize=100,
                )
                .execute()
            )
        except Exception:
            continue
        for f in response.get("files", []):
            mime = f.get("mimeType", "")
            name = f.get("name", "")
            if mime == "application/vnd.google-apps.folder":
                to_visit.append(f.get("id"))
            elif name.lower().startswith(prefix_lower) and name.lower().endswith((".xlsx", ".xls")):
                all_files.append(f)
    return all_files


def sync_from_gdrive(
    folder_id: str,
    credentials_json: str,
    prefix: str = PREFIX_PRODUCTION,
    recursive: bool = True,
) -> dict:
    """
    Сканирует папку Google Drive, находит новые файлы с именем на prefix,
    скачивает и сохраняет в data/. Возвращает {ok, downloaded: [...], errors: [...]}.
    """
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaIoBaseDownload
        import io
    except ImportError:
        return {
            "ok": False,
            "error": "Установите: pip install google-api-python-client google-auth",
            "downloaded": [],
            "errors": [],
        }

    result = {"ok": True, "downloaded": [], "errors": []}

    try:
        creds_dict = json.loads(credentials_json)
    except json.JSONDecodeError as e:
        result["ok"] = False
        result["error"] = f"Неверный JSON учётных данных: {e}"
        return result

    try:
        credentials = service_account.Credentials.from_service_account_info(creds_dict)
        service = build("drive", "v3", credentials=credentials, cache_discovery=False)
    except Exception as e:
        result["ok"] = False
        result["error"] = str(e)
        return result

    processed = _load_processed()
    prefix_lower = prefix.lower().strip()

    try:
        if recursive:
            files = _list_files_recursive(service, folder_id, prefix_lower)
        else:
            query = f"'{folder_id}' in parents and trashed = false"
            response = (
                service.files()
                .list(
                    q=query,
                    fields="files(id, name, mimeType, modifiedTime)",
                    pageSize=100,
                )
                .execute()
            )
            files = [f for f in response.get("files", [])
                     if f.get("name", "").lower().startswith(prefix_lower)
                     and f.get("name", "").lower().endswith((".xlsx", ".xls"))]
    except Exception as e:
        result["ok"] = False
        result["error"] = f"Ошибка чтения папки: {e}"
        return result

    data_dir = db.get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)

    for f in files:
        name = f.get("name", "")
        if not name.lower().startswith(prefix_lower):
            continue
        if not name.lower().endswith((".xlsx", ".xls")):
            continue
        file_id = f.get("id")
        if not file_id:
            continue
        modified_time = f.get("modifiedTime") or ""
        prev = processed.get(str(file_id))
        if prev and prev.get("modified_time") == modified_time:
            continue
        if prev and prev.get("saved_as"):
            old_path = data_dir / prev["saved_as"]
            if old_path.exists():
                try:
                    old_path.unlink()
                    logger.info("gdrive sync: removed outdated %s", prev["saved_as"])
                except Exception as e:
                    logger.warning("gdrive sync: could not remove %s: %s", prev["saved_as"], e)

        try:
            request = service.files().get_media(fileId=file_id)
            buf = io.BytesIO()
            downloader = MediaIoBaseDownload(buf, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            content = buf.getvalue()
        except Exception as e:
            result["errors"].append({"file": name, "error": str(e)})
            logger.warning("gdrive sync: download failed %s: %s", name, e)
            continue

        safe_name = f"gdrive_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{file_id[:8]}.xlsx"
        dest = data_dir / safe_name
        dest.write_bytes(content)

        processed[str(file_id)] = {
            "name": name,
            "saved_as": safe_name,
            "at": datetime.now().isoformat(),
            "modified_time": modified_time,
        }
        result["downloaded"].append({"name": name, "saved_as": safe_name})
        logger.info("gdrive sync: downloaded %s -> %s", name, safe_name)

    _save_processed(processed)

    if result["downloaded"]:
        db.refresh_data()
        try:
            import telegram_notify
            telegram_notify.notify_data_updated("gdrive", downloaded=result["downloaded"])
        except Exception:
            pass

    return result
