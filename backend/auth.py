"""Аутентификация: admin и PR. Логирование входов."""

import os
import secrets
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

# Admin — из env (ANALYTICS_USER, ANALYTICS_PASSWORD)
# PR — фиксированный пароль Plkdf45, без доступа к админке
# Pavel — без доступа к админке
ADMIN_USER = os.environ.get("ANALYTICS_USER", "admin")
ADMIN_PASSWORD = os.environ.get("ANALYTICS_PASSWORD", "logos22")
PR_USER = "PR"
PR_PASSWORD = "Plkdf45"
PAVEL_USER = "pavel"
PAVEL_PASSWORD = "Pv7k9m"
NP_USER = "NP"
NP_PASSWORD = "342GbfBf33"
GUEST_USER = "Guest"
GUEST_PASSWORD = "Pdf#$178^Hh"

# Пользователи модуля «Графики и табели»
# role: "admin"     — полный доступ ко всему модулю (все производства)
#       "manager"   — начальник цеха: график + табель + аналитика своего производства
#       "brigadier" — бригадир: только табель своего производства
#       "viewer"    — просмотр всех табелей, без редактирования
# production: "tea" | "engraving" | "luminarc" | "all"
WORKFORCE_USERS: dict[str, dict] = {
    # ── Дефолтные технические аккаунты (обратная совместимость) ──────────────
    "tea_head":            {"password": "TeaHead2026",  "role": "manager",   "production": "tea"},
    "tea_brigadier":       {"password": "TeaBrig2026",  "role": "brigadier", "production": "tea"},
    "engraving_head":      {"password": "EngHead2026",  "role": "manager",   "production": "engraving"},
    "engraving_brigadier": {"password": "EngBrig2026",  "role": "brigadier", "production": "engraving"},
    "luminarc_head":       {"password": "LumHead2026",  "role": "manager",   "production": "luminarc"},
    "luminarc_brigadier":  {"password": "LumBrig2026",  "role": "brigadier", "production": "luminarc"},

    # ── Менеджеры (График + Табель + Аналитика) ───────────────────────────────
    # Люминарк
    "spodarki001@gmail.com": {
        "password": "Mh!2026Lm", "role": "manager", "production": "luminarc",
        "full_name": "Мхитарян Александр Михайлович",
    },
    # Чай
    "pn@podarkioptom.ru": {
        "password": "Nk!2026Tc", "role": "manager", "production": "tea",
        "full_name": "Николаев Павел Николаевич",
    },
    # Гравировка
    "m70870378@gmail.com": {
        "password": "KM!2026Gr", "role": "manager", "production": "engraving",
        "full_name": "Ким Михаил Алексеевич",
    },

    # ── Бригадиры Люминарк (только Табель) ───────────────────────────────────
    "korneichukstanislaw@gmail.com": {
        "password": "Kn!2026Lm", "role": "brigadier", "production": "luminarc",
        "full_name": "Корнейчук Станислав Сергеевич",
    },
    "nooooyes1@gmail.com": {
        "password": "St!2026Lm", "role": "brigadier", "production": "luminarc",
        "full_name": "Старовойтова Рамира-Франческа Юрьевна",
    },

    # ── Бригадиры Чай (только Табель) ────────────────────────────────────────
    "andrnovo4444@gmail.com": {
        "password": "NA!2026Tc", "role": "brigadier", "production": "tea",
        "full_name": "Новожилов Андрей Алексеевич",
    },
    "kimulia829@gmail.com": {
        "password": "KY!2026Tc", "role": "brigadier", "production": "tea",
        "full_name": "Ким Юлия Валерьевна",
    },
    "mash50052@gmail.com": {
        "password": "Ch!2026Tc", "role": "brigadier", "production": "tea",
        "full_name": "Чистякова Мария Сергеевна",
    },
    "paxxxaaa999@gmail.com": {
        "password": "NP!2026Tc", "role": "brigadier", "production": "tea",
        "full_name": "Новожилов Павел Алексеевич",
    },
    "qas.n201475@gmail.com": {
        "password": "Ng!2026Tc", "role": "brigadier", "production": "tea",
        "full_name": "Наглый Виктор",
    },
    "romsashenka90@gmail.com": {
        "password": "Ro!2026Tc", "role": "brigadier", "production": "tea",
        "full_name": "Романова Александра Андреевна",
    },
    "ruskin0404@gmail.com": {
        "password": "Rs!2026Tc", "role": "brigadier", "production": "tea",
        "full_name": "Руськин Андрей Алексеевич",
    },

    # ── Бригадиры Гравировка (только Табель) ─────────────────────────────────
    "max7576.7576@gmail.com": {
        "password": "Sh!2026Gr", "role": "brigadier", "production": "engraving",
        "full_name": "Ширяев Максим Вячеславович",
    },
    "arenafit@mail.ru": {
        "password": "Tv!2026Gr", "role": "brigadier", "production": "engraving",
        "full_name": "Теванян Карен Ованесович",
    },
    "janybekbolotbekov09@gmail.com": {
        "password": "Bl!2026Gr", "role": "brigadier", "production": "engraving",
        "full_name": "Болотбеков Жаныбек Болотбекович",
    },
    "dimax9325@gmail.com": {
        "password": "Sr!2026Gr", "role": "brigadier", "production": "engraving",
        "full_name": "Шеремет Дмитрий Александрович",
    },
    "boboevsuhrob813@gmail.com": {
        "password": "Bb!2026Gr", "role": "brigadier", "production": "engraving",
        "full_name": "Бобоев Сухроб",
    },

    # ── Полный доступ ко всему модулю (все производства) ─────────────────────
    "NP": {
        "password": NP_PASSWORD, "role": "admin", "production": "all",
        "full_name": "Начальник производства",
        "nav_items": ["month", "day", "week", "months", "disassembly",
                      "dashboard_engraving", "dashboard_tea", "dashboard_luminarc", "workforce"],
    },
    "lodygin@podarkioptom.ru": {
        "password": "Ld!2026Al", "role": "admin", "production": "all",
        "full_name": "Лодыгин Юрий Михайлович",
        "nav_items": ["month", "day", "week", "months", "disassembly",
                      "dashboard_engraving", "dashboard_tea", "dashboard_luminarc", "workforce"],
    },

    # ── Просмотр всех табелей (без редактирования) ───────────────────────────
    "buh.sycheva@gmail.com": {
        "password": "ET!2026Vw", "role": "viewer", "production": "all",
        "full_name": "Тарбаева Елена",
    },
    "hr@podarkioptom.ru": {
        "password": "Fi!2026Vw", "role": "viewer", "production": "all",
        "full_name": "Файмен Ирина",
    },
}

# token -> username
SESSIONS: dict[str, str] = {}

# История входов: [{username, at}], сохраняется в файл
_LOGIN_HISTORY: list[dict] = []
_LOGIN_HISTORY_FILE: Optional[Path] = None


def _get_history_path() -> Path:
    global _LOGIN_HISTORY_FILE
    if _LOGIN_HISTORY_FILE is None:
        base = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
        base.mkdir(parents=True, exist_ok=True)
        _LOGIN_HISTORY_FILE = base / "login_history.json"
    return _LOGIN_HISTORY_FILE


def _load_history():
    global _LOGIN_HISTORY
    path = _get_history_path()
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                _LOGIN_HISTORY = json.load(f)
        except Exception:
            _LOGIN_HISTORY = []
    else:
        _LOGIN_HISTORY = []


def _save_history():
    path = _get_history_path()
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(_LOGIN_HISTORY[-5000:], f, ensure_ascii=False)  # последние 5000
    except Exception:
        pass


def check_password(username: str, password: str) -> bool:
    """Проверка логина и пароля."""
    if username == ADMIN_USER and password == ADMIN_PASSWORD:
        return True
    if username == PR_USER and password == PR_PASSWORD:
        return True
    if username == PAVEL_USER and password == PAVEL_PASSWORD:
        return True
    if username == NP_USER and password == NP_PASSWORD:
        return True
    if username == GUEST_USER and password == GUEST_PASSWORD:
        return True
    if username in WORKFORCE_USERS and WORKFORCE_USERS[username]["password"] == password:
        return True
    return False


def is_admin(username: str) -> bool:
    """Пользователи с полным доступом к сайту и админ-странице."""
    return username in (ADMIN_USER, PAVEL_USER)


def get_schedule_access(username: str) -> dict:
    """Возвращает доступ пользователя к модулю графиков/табелей.
    Сначала проверяет переопределения из role_manager, затем WORKFORCE_USERS.
    """
    if is_admin(username):
        return {"role": "admin", "production": "all", "full_name": username, "nav_items": None}

    # Проверяем переопределения (заданные через админку)
    try:
        import role_manager as rm
        override = rm.get_role_override(username)
        if override:
            nav_items = override.get("nav_items")
            # Менеджер: По дню + По неделе + Графики и табели
            if override.get("role") == "manager" and nav_items is None:
                nav_items = ["day", "week", "workforce"]
            # Бригадир: только Графики и табели (внутри модуля — только табель)
            if override.get("role") == "brigadier" and nav_items is None:
                nav_items = ["workforce"]
            return {
                "role": override["role"],
                "production": override["production"],
                "full_name": override.get("full_name") or WORKFORCE_USERS.get(username, {}).get("full_name", username),
                "nav_items": nav_items,
            }
    except Exception:
        pass

    # Стандартные записи из WORKFORCE_USERS
    if username in WORKFORCE_USERS:
        u = WORKFORCE_USERS[username]
        nav_items = u.get("nav_items")
        # Для роли «Менеджер» по умолчанию: только «По дню», «По неделе», «Графики и табели»
        if u.get("role") == "manager" and nav_items is None:
            nav_items = ["day", "week", "workforce"]
        # Для роли «Бригадир» по умолчанию: только «Графики и табели»
        if u.get("role") == "brigadier" and nav_items is None:
            nav_items = ["workforce"]
        return {
            "role": u["role"],
            "production": u["production"],
            "full_name": u.get("full_name", username),
            "nav_items": nav_items,
        }
    return {"role": None, "production": None, "full_name": None, "nav_items": None}


def get_workforce_user_info(username: str) -> Optional[dict]:
    """Получить полную информацию о пользователе модуля графиков."""
    return WORKFORCE_USERS.get(username)


def create_session(username: str) -> str:
    """Создать сессию, вернуть токен."""
    token = secrets.token_urlsafe(32)
    SESSIONS[token] = username
    return token


def get_username(token: Optional[str]) -> Optional[str]:
    """Проверить токен, вернуть username или None."""
    if not token:
        return None
    return SESSIONS.get(token)


def logout(token: Optional[str]) -> None:
    """Завершить сессию."""
    if token and token in SESSIONS:
        del SESSIONS[token]


def log_login(username: str) -> None:
    """Записать вход в историю."""
    if not _LOGIN_HISTORY:
        _load_history()
    _LOGIN_HISTORY.append({
        "username": username,
        "at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    _save_history()


def get_login_history() -> dict:
    """История входов: список и агрегат по пользователям. Только для admin."""
    if not _LOGIN_HISTORY:
        _load_history()
    by_user: dict = {}
    for e in _LOGIN_HISTORY:
        u = e.get("username", "?")
        if u not in by_user:
            by_user[u] = {"count": 0, "last": None}
        by_user[u]["count"] += 1
        by_user[u]["last"] = e.get("at")
    return {
        "logins": _LOGIN_HISTORY[-200:][::-1],
        "by_user": by_user,
    }
