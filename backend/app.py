"""FastAPI приложение аналитики выпуска продукции."""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

# Загружаем .env (корень проекта или backend/) для OPENAI_API_KEY, ANALYTICS_* и др.
try:
    from dotenv import load_dotenv
    _root = Path(__file__).resolve().parent.parent
    load_dotenv(_root / ".env")
    load_dotenv(Path(__file__).resolve().parent / ".env")  # на случай если .env лежит в backend/
except ImportError:
    pass

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse

import database as db
import auth
import theme as theme_mod


def require_auth(request: Request) -> str:
    """Проверка авторизации по cookie. Вызывает 401 при отсутствии."""
    token = request.cookies.get("analytics_session")
    username = auth.get_username(token)
    if not username:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    return username


def require_admin(username: str = Depends(require_auth)) -> str:
    """Только admin. PR и др. — 403."""
    if not auth.is_admin(username):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
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
    "https://proanalitik.onrender.com", "https://www.proanalitik.onrender.com",
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
    auth.log_login(username)
    token = auth.create_session(username)
    response = JSONResponse({"ok": True})
    response.set_cookie("analytics_session", token, httponly=True, samesite="lax", max_age=7 * 24 * 3600, path="/")
    return response


@app.get("/api/dev-auto-login")
async def dev_auto_login(request: Request, next: str = "/"):
    """Автовход под админом. Только для localhost (dev). next — куда редирект после входа."""
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="Только для localhost")
    if not auth.check_password(auth.ADMIN_USER, auth.ADMIN_PASSWORD):
        raise HTTPException(status_code=500, detail="Нет учётных данных админа")
    auth.log_login(auth.ADMIN_USER)
    token = auth.create_session(auth.ADMIN_USER)
    redirect_to = next if next.startswith("/") else "/"
    r = RedirectResponse(url=redirect_to, status_code=302)
    r.set_cookie("analytics_session", token, httponly=True, samesite="lax", max_age=7 * 24 * 3600, path="/")
    return r


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
def get_me(username: str = Depends(require_auth)):
    """Проверка авторизации. Возвращает username и is_admin."""
    return {"ok": True, "username": username, "is_admin": auth.is_admin(username)}


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
    try:
        import telegram_notify
        telegram_notify.notify_data_updated("upload")
    except Exception:
        pass
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


def _mailparser_to_excel(body: dict) -> Optional[bytes]:
    """Преобразует данные из Mailparser webhook в Excel. Возвращает bytes или None."""
    import io
    import pandas as pd
    from parser import parse_date

    data = body.get("parsed_data") or body.get("data") or body
    if not isinstance(data, dict):
        return None

    # Поддержка разных форматов Mailparser
    # 1) Колонки как массивы: { "Артикул": [...], "Вид номенклатуры": [...], ... }
    # 2) Строки: { "rows": [ {col: val, ...}, ... ] } или data: [...]
    rows = []
    col_map = {
        "article": ["article", "articul", "артикул"],
        "nomenclature_type": ["nomenclature_type", "nomenclature", "вид номенклатуры", "вид_номенклатуры"],
        "product_name": ["product_name", "product", "наименование", "наименование продукции"],
        "quantity": ["quantity", "количество", "количество выпущено"],
        "date": ["date", "дата", "дата выпуска", "дата_выпуска"],
        "department": ["department", "подразделение", "department_name"],
    }

    def find_col(d: dict, aliases: list) -> Optional[str]:
        aliases_lower = [a.lower() for a in aliases]
        for dk in d:
            if str(dk).strip().lower() in aliases_lower:
                return dk
        return None

    # Формат: одна строка (One Request Per Row)
    if not rows:
        row = {}
        for our_name, aliases in col_map.items():
            key = find_col(data, aliases)
            if key and key in data:
                row[our_name] = data[key]
        if len(row) >= 4:
            rows.append(row)

    # Формат: массивы по колонкам
    if not rows:
        first_arr = None
        for v in data.values():
            if isinstance(v, list) and len(v) > 0:
                first_arr = v
                break
        if first_arr and isinstance(first_arr, list):
            n = len(first_arr)
            out_cols = {}
            for our_name, aliases in col_map.items():
                key = find_col(data, aliases)
                if key and key in data:
                    vals = data[key]
                    if isinstance(vals, list) and len(vals) >= n:
                        out_cols[our_name] = list(vals)[:n]
                    elif not isinstance(vals, list):
                        out_cols[our_name] = [vals] * n
            if len(out_cols) >= 4:
                for i in range(n):
                    row = {k: (v[i] if i < len(v) else "") for k, v in out_cols.items()}
                    rows.append(row)

    # Формат: массив объектов-строк
    if not rows:
        arr = data.get("rows") or data.get("data") or data.get("items")
        if isinstance(arr, list):
            for item in arr:
                if isinstance(item, dict):
                    row = {}
                    for our_name, aliases in col_map.items():
                        key = find_col(item, aliases)
                        if key and key in item:
                            row[our_name] = item[key]
                    if len(row) >= 4:
                        rows.append(row)

    if not rows:
        return None

    df = pd.DataFrame(rows)
    for c in ["article", "nomenclature_type", "product_name", "department"]:
        if c in df.columns:
            df[c] = df[c].fillna("").astype(str).str.strip()
    if "quantity" in df.columns:
        df["quantity"] = pd.to_numeric(df["quantity"], errors="coerce").fillna(0).astype(int)
    if "date" in df.columns:
        df["date"] = df["date"].apply(lambda x: parse_date(x) or pd.NaT)
        df = df[df["date"].notna()]

    needed = ["article", "nomenclature_type", "product_name", "quantity", "date", "department"]
    for c in needed:
        if c not in df.columns:
            df[c] = "" if c != "quantity" else 0
    df = df[needed]
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    return buf.getvalue()


@app.post("/api/upload-from-mailparser")
async def upload_from_mailparser(
    request: Request,
    x_upload_token: str = Header(None, alias="X-Upload-Token"),
):
    """Приём данных из Mailparser webhook. Заголовок: X-Upload-Token."""
    expected = os.environ.get("UPLOAD_TOKEN", "")
    if not expected or not x_upload_token or x_upload_token != expected:
        raise HTTPException(status_code=403, detail="Неверный или отсутствующий токен")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Ожидается JSON")
    excel_bytes = _mailparser_to_excel(body)
    if not excel_bytes:
        raise HTTPException(status_code=400, detail="Не удалось извлечь данные. Ожидается parsed_data с колонками: Артикул, Вид номенклатуры, Наименование, Количество, Дата, Подразделение")
    from datetime import datetime
    filename = f"mailparser_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return _do_upload(excel_bytes, filename)


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


def _check_upload_token(x_upload_token: str = Header(None, alias="X-Upload-Token")):
    """Проверка токена для автоматизации (cron, webhooks)."""
    expected = os.environ.get("UPLOAD_TOKEN", "")
    if not expected or not x_upload_token or x_upload_token != expected:
        raise HTTPException(status_code=403, detail="Неверный или отсутствующий токен")


@app.get("/api/sync-from-gdrive")
def sync_from_gdrive_api(
    x_upload_token: str = Header(None, alias="X-Upload-Token"),
):
    """
    Синхронизация из Google Drive: забирает новые файлы с именем «Выпуск продукции*»
    и загружает в аналитику. Вызывается cron-ом или вручную.
    Заголовок: X-Upload-Token.
    """
    _check_upload_token(x_upload_token)
    folder_id = os.environ.get("GOOGLE_DRIVE_FOLDER_ID", "")
    credentials = os.environ.get("GOOGLE_DRIVE_CREDENTIALS_JSON", "")
    prefix = os.environ.get("GOOGLE_DRIVE_PREFIX_PRODUCTION", "Выпуск продукции")
    recursive = os.environ.get("GOOGLE_DRIVE_RECURSIVE", "true").lower() in ("1", "true", "yes")
    if not folder_id or not credentials:
        return {
            "ok": False,
            "error": "Задайте GOOGLE_DRIVE_FOLDER_ID и GOOGLE_DRIVE_CREDENTIALS_JSON",
            "downloaded": [],
            "errors": [],
        }
    import gdrive_sync
    return gdrive_sync.sync_from_gdrive(
        folder_id=folder_id,
        credentials_json=credentials,
        prefix=prefix.strip(),
        recursive=recursive,
    )


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


@app.get("/api/theme")
def api_get_theme():
    """Текущая цветовая схема (для всех пользователей)."""
    return {"theme": theme_mod.get_theme()}


@app.post("/api/theme", dependencies=[Depends(require_admin)])
async def set_theme_api(request: Request):
    """Сохранить тему для всех пользователей. Только admin."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Ожидается JSON"}, status_code=400)
    t = body.get("theme", "")
    if t not in theme_mod.THEMES:
        return JSONResponse({"error": f"Неизвестная тема. Допустимо: {theme_mod.THEMES}"}, status_code=400)
    if not theme_mod.set_theme(t):
        return JSONResponse({"error": "Ошибка сохранения"}, status_code=500)
    return {"ok": True, "theme": t}


@app.get("/api/admin/sync-from-gdrive", dependencies=[Depends(require_admin)])
def admin_sync_from_gdrive():
    """Синхронизация из Google Drive (только для admin). То же, что /api/sync-from-gdrive по токену."""
    folder_id = os.environ.get("GOOGLE_DRIVE_FOLDER_ID", "")
    credentials = os.environ.get("GOOGLE_DRIVE_CREDENTIALS_JSON", "")
    prefix = os.environ.get("GOOGLE_DRIVE_PREFIX_PRODUCTION", "Выпуск продукции")
    recursive = os.environ.get("GOOGLE_DRIVE_RECURSIVE", "true").lower() in ("1", "true", "yes")
    if not folder_id or not credentials:
        return {
            "ok": False,
            "error": "Задайте GOOGLE_DRIVE_FOLDER_ID и GOOGLE_DRIVE_CREDENTIALS_JSON",
            "downloaded": [],
            "errors": [],
        }
    import gdrive_sync
    return gdrive_sync.sync_from_gdrive(
        folder_id=folder_id,
        credentials_json=credentials,
        prefix=prefix.strip(),
        recursive=recursive,
    )


@app.get("/api/admin/data-dates", dependencies=[Depends(require_admin)])
def admin_data_dates():
    """Диагностика: какие даты есть в данных (для отладки пропавших 1–2 января)."""
    return db.get_data_date_range()


@app.get("/api/admin/login-history", dependencies=[Depends(require_admin)])
def admin_login_history():
    """История входов: кто, когда, сколько раз. Только для admin."""
    return auth.get_login_history()


@app.get("/api/day/{date_str}", dependencies=[Depends(require_auth)])
def get_day_stats(date_str: str):
    """Аналитика за день (date_str: YYYY-MM-DD)."""
    from datetime import datetime
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return {"error": "Неверный формат даты. Используйте YYYY-MM-DD"}
    return db.get_daily_stats(d)


def _sanitize_ai_error(err_msg: str) -> str:
    """Скрыть технические фрагменты (JSON/парсер) в сообщении об ошибке."""
    if not err_msg:
        return err_msg
    # Фрагмент вроде '\n "productions"' — заменить на понятное сообщение
    if "productions" in err_msg and (len(err_msg) < 80 or "\n" in err_msg or "\\n" in err_msg or '"\n' in err_msg):
        return "ИИ вернул некорректный ответ (возможна обрезка). Попробуйте ещё раз."
    return err_msg


@app.get("/api/day/{date_str}/ai-analytics", dependencies=[Depends(require_auth)])
def get_day_ai_analytics(date_str: str, debug: Optional[str] = None):
    """ИИ-аналитика за день: оценка выработки по производствам, тренды, вопросы для руководителей."""
    from datetime import datetime
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return JSONResponse({"error": "Неверный формат даты. Используйте YYYY-MM-DD", "enabled": True, "productions": {}, "general_notes": ""}, status_code=400)
    import ai_analytics
    try:
        return ai_analytics.get_ai_analytics(d)
    except Exception as e:
        err_msg = str(e).strip()
        err_msg = _sanitize_ai_error(f"Ошибка сервера: {err_msg[:300]}")
        out = {
            "enabled": True,
            "date": date_str,
            "productions": {},
            "general_notes": "",
            "error": err_msg,
        }
        if debug:
            out["debug_error_type"] = type(e).__name__
        return out


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
