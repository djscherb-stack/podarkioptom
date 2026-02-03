"""Хранение выбранной цветовой схемы для всех пользователей."""

import json
from pathlib import Path

import database as db

def _get_theme_path() -> Path:
    return db.get_data_dir() / "theme.json"

THEMES = ["dark", "bw", "1c", "white-blue", "bright"]

def get_theme() -> str:
    """Текущая тема (для всех пользователей)."""
    db.ensure_data_dir()
    path = _get_theme_path()
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                d = json.load(f)
                t = d.get("theme", "dark")
                if t in THEMES:
                    return t
        except Exception:
            pass
    return "dark"

def set_theme(theme: str) -> bool:
    """Сохранить тему. Возвращает True при успехе."""
    if theme not in THEMES:
        return False
    try:
        db.ensure_data_dir()
        path = _get_theme_path()
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"theme": theme}, f, ensure_ascii=False)
        return True
    except Exception as e:
        import logging
        logging.warning(f"theme set_theme failed: {e}")
        return False
