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
    return False


def is_admin(username: str) -> bool:
    """Только admin имеет доступ к админ-странице."""
    return username == ADMIN_USER


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
