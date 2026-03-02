"""Управление пользователями и кастомными ролями через админку."""

import json
import uuid
import os
from pathlib import Path
from typing import Optional

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
WORKFORCE_DIR = DATA_DIR / "workforce"

_OVERRIDES_FILE = WORKFORCE_DIR / "user_role_overrides.json"
_CUSTOM_ROLES_FILE = WORKFORCE_DIR / "custom_roles.json"


def _ensure_dir():
    WORKFORCE_DIR.mkdir(parents=True, exist_ok=True)


def _read_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return default


def _write_json(path: Path, data) -> None:
    _ensure_dir()
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ─── Переопределения ролей пользователей ──────────────────────────────────────

def get_role_override(username: str) -> Optional[dict]:
    """Получить переопределение роли для пользователя."""
    overrides = _read_json(_OVERRIDES_FILE, {})
    return overrides.get(username)


def set_role_override(username: str, role: str, production: str,
                      custom_role_id: Optional[str] = None,
                      nav_items: Optional[list] = None) -> None:
    """Сохранить переопределение роли для пользователя."""
    _ensure_dir()
    overrides = _read_json(_OVERRIDES_FILE, {})
    overrides[username] = {
        "role": role,
        "production": production,
        "custom_role_id": custom_role_id,
        "nav_items": nav_items,
    }
    _write_json(_OVERRIDES_FILE, overrides)


def remove_role_override(username: str) -> None:
    overrides = _read_json(_OVERRIDES_FILE, {})
    overrides.pop(username, None)
    _write_json(_OVERRIDES_FILE, overrides)


def get_all_overrides() -> dict:
    return _read_json(_OVERRIDES_FILE, {})


# ─── Кастомные роли ───────────────────────────────────────────────────────────

# Список пунктов меню, которые можно включать/выключать в роли
NAV_ITEMS = {
    "month":                    "По месяцу",
    "day":                      "По дню",
    "week":                     "По неделе",
    "months":                   "Аналитика по месяцам",
    "employee_output":          "Выработка сотрудников",
    "employees":                "Сотрудники",
    "disassembly":              "Разборка возвратов",
    "disassembly_nomenclature": "Номенклатура разборки",
    "cost_check":               "Проверка стоимости",
    "workforce":                "Графики и табели",
}

PRODUCTIONS = {
    "tea":       "ЧАЙ",
    "engraving": "ГРАВИРОВКА",
    "luminarc":  "ЛЮМИНАРК",
}

WORKFORCE_ROLES = {
    "admin":     "Полный доступ (все производства)",
    "manager":   "Менеджер (График + Табель + Аналитика)",
    "brigadier": "Бригадир (только Табель)",
    "viewer":    "Просмотр (все табели, без редактирования)",
}


def get_custom_roles() -> list:
    return _read_json(_CUSTOM_ROLES_FILE, [])


def save_custom_role(role_data: dict) -> dict:
    roles = get_custom_roles()
    if not role_data.get("id"):
        role_data["id"] = str(uuid.uuid4())
    # Update or insert
    idx = next((i for i, r in enumerate(roles) if r.get("id") == role_data["id"]), None)
    if idx is not None:
        roles[idx] = role_data
    else:
        roles.append(role_data)
    _write_json(_CUSTOM_ROLES_FILE, roles)
    return role_data


def delete_custom_role(role_id: str) -> bool:
    roles = get_custom_roles()
    before = len(roles)
    roles = [r for r in roles if r.get("id") != role_id]
    _write_json(_CUSTOM_ROLES_FILE, roles)
    return len(roles) < before


def get_custom_role_by_id(role_id: str) -> Optional[dict]:
    return next((r for r in get_custom_roles() if r.get("id") == role_id), None)
