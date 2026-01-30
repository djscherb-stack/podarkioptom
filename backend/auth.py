"""Простая аутентификация по логину и паролю."""

import os
import secrets
from typing import Optional

# Учётные данные из переменных окружения (для продакшена)
AUTH_USER = os.environ.get("ANALYTICS_USER", "admin")
AUTH_PASSWORD = os.environ.get("ANALYTICS_PASSWORD", "vuhzyf")

# Хранилище сессий: token -> username
SESSIONS: dict[str, str] = {}


def check_password(username: str, password: str) -> bool:
    """Проверка логина и пароля."""
    return username == AUTH_USER and password == AUTH_PASSWORD


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
