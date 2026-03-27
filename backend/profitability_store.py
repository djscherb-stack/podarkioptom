"""
Хранилище данных модуля рентабельности.

Файловая структура в DATA_DIR/profitability/:
  uploads/
    weekly/     — еженедельные отчёты (.xlsx), имя файла = {period_id}.xlsx
    nomenclature/ — виды номенклатуры (.xlsx)
    costs/      — себестоимости (.xlsx)
  periods.json  — метаданные периодов
  work_rates.json — ставки работы {period_id: {luminarc, engraving, tea}}
  custom_mappings.json — {артикул: вид_номенклатуры}
  mappings_history.json — история изменений маппинга
"""

import json
import os
import time
from pathlib import Path
from typing import Optional

import database as db


def _prof_dir() -> Path:
    p = Path(db.DATA_DIR) / "profitability"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _uploads_dir(kind: str) -> Path:
    d = _prof_dir() / "uploads" / kind
    d.mkdir(parents=True, exist_ok=True)
    return d


def _json_path(name: str) -> Path:
    return _prof_dir() / name


def _read_json(name: str, default):
    p = _json_path(name)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return default
    return default


def _write_json(name: str, data) -> None:
    p = _json_path(name)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Периоды
# ---------------------------------------------------------------------------

def list_periods() -> list[dict]:
    """Возвращает список всех загруженных периодов (еженедельных отчётов)."""
    return _read_json("periods.json", [])


def save_period(period_id: str, label: str, filename: str) -> dict:
    """Добавляет или обновляет запись о периоде."""
    periods = list_periods()
    existing = next((p for p in periods if p["id"] == period_id), None)
    if existing:
        existing["label"] = label
        existing["filename"] = filename
        existing["updated_at"] = time.time()
    else:
        periods.append({
            "id": period_id,
            "label": label,
            "filename": filename,
            "created_at": time.time(),
            "updated_at": time.time(),
        })
    # Сортируем по id (обычно дата)
    periods.sort(key=lambda x: x["id"], reverse=True)
    _write_json("periods.json", periods)
    return next(p for p in periods if p["id"] == period_id)


def delete_period(period_id: str) -> bool:
    periods = list_periods()
    new = [p for p in periods if p["id"] != period_id]
    if len(new) == len(periods):
        return False
    _write_json("periods.json", new)
    # Удаляем файл (старый формат) или директорию (новый формат)
    d = _uploads_dir("weekly")
    old_file = d / f"{period_id}.xlsx"
    if old_file.exists():
        old_file.unlink()
    period_dir = d / period_id
    if period_dir.exists():
        import shutil
        shutil.rmtree(period_dir)
    return True


# ---------------------------------------------------------------------------
# Загрузка файлов
# ---------------------------------------------------------------------------

def save_upload(kind: str, file_bytes: bytes, period_id: Optional[str] = None) -> str:
    """
    Сохраняет загруженный файл.
    kind: 'weekly' | 'nomenclature' | 'costs'
    Для 'weekly': файлы хранятся в uploads/weekly/{period_id}/, можно загрузить несколько.
    Для остальных — перезаписывает единственный файл.
    Возвращает путь к сохранённому файлу.
    """
    d = _uploads_dir(kind)
    if kind == "weekly":
        if not period_id:
            raise ValueError("period_id обязателен для еженедельного отчёта")
        period_dir = d / period_id
        period_dir.mkdir(parents=True, exist_ok=True)
        idx = len(list(period_dir.glob("*.xlsx"))) + 1
        path = period_dir / f"{idx}.xlsx"
    else:
        path = d / "latest.xlsx"

    path.write_bytes(file_bytes)
    return str(path)


def load_weekly_reports(period_id: str) -> list[bytes]:
    """
    Возвращает список байт всех загруженных отчётов для периода.
    Поддерживает старый формат (один файл {period_id}.xlsx) и
    новый формат (директория {period_id}/ с несколькими файлами).
    """
    d = _uploads_dir("weekly")
    results: list[bytes] = []

    # Новый формат: директория
    period_dir = d / period_id
    if period_dir.exists():
        for f in sorted(period_dir.glob("*.xlsx")):
            results.append(f.read_bytes())

    # Старый формат: одиночный файл (обратная совместимость)
    old_file = d / f"{period_id}.xlsx"
    if old_file.exists():
        results.append(old_file.read_bytes())

    return results


def count_weekly_reports(period_id: str) -> int:
    """Количество загруженных отчётов для периода."""
    return len(load_weekly_reports(period_id))


def load_upload(kind: str, period_id: Optional[str] = None) -> Optional[bytes]:
    """Читает первый доступный файл (для обратной совместимости)."""
    if kind == "weekly":
        files = load_weekly_reports(period_id) if period_id else []
        return files[0] if files else None

    d = _uploads_dir(kind)
    path = d / "latest.xlsx"

    if not path.exists():
        return None
    return path.read_bytes()


def has_upload(kind: str, period_id: Optional[str] = None) -> bool:
    return load_upload(kind, period_id) is not None


# ---------------------------------------------------------------------------
# Ставки работы
# ---------------------------------------------------------------------------

def get_work_rates() -> dict:
    """
    Возвращает все ставки работы.
    Структура: {period_id: {luminarc: float, engraving: float, tea: float}}
    Плюс 'default' — глобальные ставки по умолчанию.
    """
    return _read_json("work_rates.json", {"default": {"luminarc": 0.0, "engraving": 0.0, "tea": 0.0}})


def get_work_rates_for_period(period_id: str) -> dict:
    """
    Возвращает ставки для конкретного периода.
    Если нет — берём default.
    """
    all_rates = get_work_rates()
    period_rates = all_rates.get(period_id)
    if period_rates:
        return period_rates
    return all_rates.get("default", {"luminarc": 0.0, "engraving": 0.0, "tea": 0.0})


def set_work_rates(period_id: str, rates: dict) -> None:
    """
    Устанавливает ставки для периода (или 'default').
    rates: {luminarc: float, engraving: float, tea: float}
    """
    all_rates = get_work_rates()
    all_rates[period_id] = {
        "luminarc": float(rates.get("luminarc", 0.0)),
        "engraving": float(rates.get("engraving", 0.0)),
        "tea": float(rates.get("tea", 0.0)),
    }
    _write_json("work_rates.json", all_rates)


# ---------------------------------------------------------------------------
# Маппинги артикулов
# ---------------------------------------------------------------------------

def get_custom_mappings() -> dict[str, str]:
    """Возвращает кастомные маппинги {артикул: вид_номенклатуры}."""
    return _read_json("custom_mappings.json", {})


def set_custom_mapping(article: str, vid: str, username: str = "unknown") -> None:
    """Добавляет или обновляет кастомный маппинг."""
    mappings = get_custom_mappings()
    old_vid = mappings.get(article)
    mappings[article] = vid
    _write_json("custom_mappings.json", mappings)

    # История изменений
    history = _read_json("mappings_history.json", [])
    history.append({
        "ts": time.time(),
        "article": article,
        "old_vid": old_vid,
        "new_vid": vid,
        "by": username,
    })
    _write_json("mappings_history.json", history)


def set_custom_mappings_bulk(mappings_dict: dict[str, str], username: str = "unknown") -> None:
    """Bulk-обновление маппингов."""
    mappings = get_custom_mappings()
    history = _read_json("mappings_history.json", [])
    for article, vid in mappings_dict.items():
        old = mappings.get(article)
        mappings[article] = vid
        history.append({
            "ts": time.time(),
            "article": article,
            "old_vid": old,
            "new_vid": vid,
            "by": username,
        })
    _write_json("custom_mappings.json", mappings)
    _write_json("mappings_history.json", history)


def get_mappings_history() -> list:
    return _read_json("mappings_history.json", [])


# ---------------------------------------------------------------------------
# Кэш номенклатуры и себестоимости (parsed)
# ---------------------------------------------------------------------------

def save_parsed_nomenclature(data: dict) -> None:
    _write_json("nomenclature_parsed.json", data)


def load_parsed_nomenclature() -> Optional[dict]:
    d = _prof_dir() / "nomenclature_parsed.json"
    if d.exists():
        try:
            return json.loads(d.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def save_parsed_costs(data: dict) -> None:
    _write_json("costs_parsed.json", data)


def load_parsed_costs() -> Optional[dict]:
    d = _prof_dir() / "costs_parsed.json"
    if d.exists():
        try:
            return json.loads(d.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None
