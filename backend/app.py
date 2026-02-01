"""FastAPI приложение аналитики выпуска продукции."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

import database as db
import auth


def require_auth(request: Request) -> str:
    """Проверка авторизации по cookie. Вызывает 401 при отсутствии."""
    token = request.cookies.get("analytics_session")
    username = auth.get_username(token)
    if not username:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    return username


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Инициализация при старте, перезагрузка при изменении файлов."""
    db.refresh_data()
    yield
    # shutdown if needed


app = FastAPI(title="Аналитика выпуска продукции", lifespan=lifespan)

# CORS: с credentials нельзя использовать "*", указываем явные origins
import os
_cors_origins = [
    "http://localhost:5173", "http://localhost:8000",
    "http://127.0.0.1:5173", "http://127.0.0.1:8000",
    "https://podarkioptom.onrender.com", "https://www.podarkioptom.onrender.com",
]
_extra = os.environ.get("CORS_ORIGINS", "")
if _extra:
    _cors_origins.extend(x.strip() for x in _extra.split(",") if x.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/login")
async def login_post(request: Request):
    """Вход по логину и паролю."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Ожидается JSON"}, status_code=400)
    username = body.get("username", "")
    password = body.get("password", "")
    if not auth.check_password(username, password):
        return JSONResponse({"error": "Неверный логин или пароль"}, status_code=401)
    token = auth.create_session(username)
    response = JSONResponse({"ok": True})
    response.set_cookie("analytics_session", token, httponly=True, samesite="lax", max_age=7 * 24 * 3600, path="/")
    return response


@app.post("/api/logout")
def logout(request: Request):
    """Выход из системы."""
    token = request.cookies.get("analytics_session")
    auth.logout(token)
    response = JSONResponse({"ok": True})
    # Удаляем cookie — те же path/samesite, что при установке
    response.set_cookie("analytics_session", "", httponly=True, samesite="lax", max_age=0, path="/")
    return response


@app.get("/api/me")
def get_me(_: str = Depends(require_auth)):
    """Проверка авторизации."""
    return {"ok": True}


@app.get("/api/version", dependencies=[Depends(require_auth)])
def version():
    """Версия API (productions = новый формат)."""
    return {"format": "productions", "version": 2}


@app.get("/api/refresh", dependencies=[Depends(require_auth)])
def refresh():
    """Принудительная перезагрузка данных из папки."""
    db.refresh_data()
    return {"status": "ok"}


def _do_upload(content: bytes, filename: str) -> dict:
    """Общая логика загрузки Excel."""
    from datetime import datetime
    if len(content) > 15 * 1024 * 1024:
        return {"error": "Файл слишком большой (макс. 15 МБ)"}
    data_dir = db.get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    ext = ".xlsx" if filename.lower().endswith(".xlsx") else ".xls"
    safe_name = f"upload_{datetime.now().strftime('%Y%m%d_%H%M%S')}{ext}"
    dest = data_dir / safe_name
    dest.write_bytes(content)
    db.refresh_data()
    return {"status": "ok", "file": safe_name}


@app.post("/api/upload", dependencies=[Depends(require_auth)])
async def upload_excel(file: UploadFile = File(...)):
    """Загрузка Excel-файла (требуется авторизация). Дубликаты отфильтровываются."""
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        return {"error": "Нужен файл Excel (.xlsx или .xls)"}
    try:
        content = await file.read()
        return _do_upload(content, file.filename)
    except Exception as e:
        return {"error": f"Ошибка: {str(e)}"}


@app.post("/api/upload-by-token")
async def upload_by_token(
    file: UploadFile = File(...),
    x_upload_token: str = Header(None, alias="X-Upload-Token"),
):
    """Загрузка Excel по токену (для автоматизации). Заголовок: X-Upload-Token."""
    expected = os.environ.get("UPLOAD_TOKEN", "")
    if not expected or not x_upload_token or x_upload_token != expected:
        raise HTTPException(status_code=403, detail="Неверный или отсутствующий токен")
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        return {"error": "Нужен файл Excel (.xlsx или .xls)"}
    try:
        content = await file.read()
        return _do_upload(content, file.filename)
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/months", dependencies=[Depends(require_auth)])
def get_months():
    """Список доступных месяцев."""
    return db.get_available_months()


@app.get("/api/months-comparison", dependencies=[Depends(require_auth)])
def get_months_comparison():
    """Сравнение выпуска по трём производствам по месяцам."""
    return db.get_months_comparison()


@app.get("/api/month/{year}/{month}", dependencies=[Depends(require_auth)])
def get_month_stats(year: int, month: int):
    """Аналитика за месяц."""
    return db.get_monthly_stats(year, month)


@app.get("/api/department-daily/{year}/{month}", dependencies=[Depends(require_auth)])
def get_department_daily(production: str, department: str, year: int, month: int):
    """Выпуск по дням для подразделения за месяц (query: production, department)."""
    from urllib.parse import unquote
    return db.get_department_daily_stats(unquote(production), unquote(department), year, month)


@app.get("/api/day/{date_str}", dependencies=[Depends(require_auth)])
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
