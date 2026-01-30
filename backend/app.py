"""FastAPI приложение аналитики выпуска продукции."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

import database as db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Инициализация при старте, перезагрузка при изменении файлов."""
    db.refresh_data()
    yield
    # shutdown if needed


app = FastAPI(title="Аналитика выпуска продукции", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/version")
def version():
    """Версия API (productions = новый формат)."""
    return {"format": "productions", "version": 2}


@app.get("/api/refresh")
def refresh():
    """Принудительная перезагрузка данных из папки."""
    db.refresh_data()
    return {"status": "ok"}


@app.get("/api/months")
def get_months():
    """Список доступных месяцев."""
    return db.get_available_months()


@app.get("/api/month/{year}/{month}")
def get_month_stats(year: int, month: int):
    """Аналитика за месяц."""
    return db.get_monthly_stats(year, month)


@app.get("/api/department-daily/{year}/{month}")
def get_department_daily(production: str, department: str, year: int, month: int):
    """Выпуск по дням для подразделения за месяц (query: production, department)."""
    from urllib.parse import unquote
    return db.get_department_daily_stats(unquote(production), unquote(department), year, month)


@app.get("/api/day/{date_str}")
def get_day_stats(date_str: str):
    """Аналитика за день (date_str: YYYY-MM-DD)."""
    from datetime import datetime
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return {"error": "Неверный формат даты. Используйте YYYY-MM-DD"}
    return db.get_daily_stats(d)


# Раздача статики React (после сборки)
FRONTEND_BUILD = Path(__file__).resolve().parent.parent / "frontend" / "dist"


def _serve_frontend():
    """Раздача frontend для production."""
    if (FRONTEND_BUILD / "index.html").exists():
        return FileResponse(FRONTEND_BUILD / "index.html")
    return {"message": "Frontend не собран. Запустите: cd frontend && npm run build"}


@app.get("/")
def serve_index():
    return _serve_frontend()


if FRONTEND_BUILD.exists() and (FRONTEND_BUILD / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_BUILD / "assets"), name="assets")


@app.get("/{path:path}")
def serve_spa(path: str):
    """SPA fallback для React Router."""
    full = FRONTEND_BUILD / path
    if full.exists() and full.is_file():
        return FileResponse(full)
    return _serve_frontend()
