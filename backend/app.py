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
    """Проверка авторизации. Возвращает username, is_admin и доступ к графикам/табелям."""
    access = auth.get_schedule_access(username)
    return {
        "ok": True,
        "username": username,
        "is_admin": auth.is_admin(username),
        "schedule_role": access["role"],
        "schedule_production": access["production"],
        "schedule_full_name": access.get("full_name"),
    }


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


PRICE_FILENAME = "цена поступления номенклатуры.xlsx"


@app.post("/api/upload-prices", dependencies=[Depends(require_auth)])
async def upload_prices(file: UploadFile = File(...)):
    """Загрузка файла себестоимости (цена поступления номенклатуры.xlsx). Сохраняется с фиксированным именем."""
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        return {"error": "Нужен файл Excel (.xlsx или .xls)"}
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        return {"error": "Файл слишком большой (макс. 5 МБ)"}
    data_dir = db.get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    dest = data_dir / PRICE_FILENAME
    dest.write_bytes(content)
    db.refresh_data()
    return {"status": "ok", "file": PRICE_FILENAME}


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
    employee_prefix = os.environ.get("GOOGLE_DRIVE_PREFIX_EMPLOYEE_OUTPUT", "Выработка сотрудников")
    recursive = os.environ.get("GOOGLE_DRIVE_RECURSIVE", "true").lower() in ("1", "true", "yes")
    disassembly_raw = os.environ.get("GOOGLE_DRIVE_PREFIXES_DISASSEMBLY", "")
    disassembly_prefixes = [p.strip() for p in disassembly_raw.split(",") if p.strip()] if disassembly_raw else [
        "001", "002", "003", "004",
        "001 Перемещение возвратов на склад разборки LUMINARC",
        "002 Поступление ингредиентов после разбора на склад разборки LUMINARC",
        "003 Списание битой посуды со склада LUMINARC",
        "004 Перемещение со склада разборки LUMINARC на основной склад",
    ]
    if not folder_id or not credentials:
        res = {
            "ok": False,
            "error": "Задайте GOOGLE_DRIVE_FOLDER_ID и GOOGLE_DRIVE_CREDENTIALS_JSON",
            "downloaded": [],
            "errors": [],
        }
        try:
            import sync_log
            sync_log.log_sync("cron", res)
        except Exception:
            pass
        return res
    import gdrive_sync
    import sync_log
    res = gdrive_sync.sync_from_gdrive(
        folder_id=folder_id,
        credentials_json=credentials,
        prefix=prefix.strip(),
        recursive=recursive,
        employee_prefix=employee_prefix.strip() or None,
        disassembly_prefixes=disassembly_prefixes,
    )
    sync_log.log_sync("cron", res)
    return res


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


@app.get("/api/weeks", dependencies=[Depends(require_auth)])
def get_weeks():
    """Список доступных недель (ISO-год/номер и диапазон дат)."""
    return db.get_available_weeks()


@app.get("/api/week/{year}/{week}", dependencies=[Depends(require_auth)])
def get_week_stats(year: int, week: int):
    """Аналитика за неделю (сравнение с предыдущей неделей)."""
    return db.get_weekly_stats(year, week)


@app.get("/api/department-daily/{year}/{month}", dependencies=[Depends(require_auth)])
def get_department_daily(production: str, department: str, year: int, month: int):
    """Выпуск по дням для подразделения за месяц (query: production, department)."""
    from urllib.parse import unquote
    return db.get_department_daily_stats(unquote(production), unquote(department), year, month)


@app.get("/api/disassembly/stats", dependencies=[Depends(require_auth)])
def get_disassembly_stats_api(group_by: str = "day", date_from: Optional[str] = None, date_to: Optional[str] = None):
    """Аналитика разборки возвратов: по дням / неделям / месяцам."""
    from datetime import datetime as dt
    d_from = None
    d_to = None
    if date_from:
        try:
            d_from = dt.strptime(date_from, "%Y-%m-%d").date()
        except ValueError:
            pass
    if date_to:
        try:
            d_to = dt.strptime(date_to, "%Y-%m-%d").date()
        except ValueError:
            pass
    if group_by not in ("day", "week", "month"):
        group_by = "day"
    return db.get_disassembly_stats(group_by=group_by, date_from=d_from, date_to=d_to)


@app.get("/api/disassembly/summary", dependencies=[Depends(require_auth)])
def get_disassembly_summary_api(period: str = "month", top_in: int = 5, top_internal: int = 15, top_out: int = 15):
    """Сводка разборки: топ поступлений, списаний, отгрузок за период (неделя / месяц / всё время)."""
    if period not in ("week", "month", "all"):
        period = "month"
    return db.get_disassembly_summary(period=period, top_in=top_in, top_internal=top_internal, top_out=top_out)


@app.get("/api/disassembly/detail", dependencies=[Depends(require_auth)])
def get_disassembly_detail_api(date_str: str, flow: str = "in", detail_type: str = "nomenclature"):
    """Детализация разборки за дату: по номенклатуре, по документам, по статьям списания (для internal)."""
    if flow not in ("in", "ingredients", "out", "internal"):
        return {"error": "flow: in | ingredients | out | internal", "items": []}
    if detail_type not in ("nomenclature", "documents", "articles"):
        if not (flow == "internal" and detail_type == "articles"):
            detail_type = "nomenclature"
    return db.get_disassembly_detail_by_date(date_str, detail_type=detail_type, flow=flow)


@app.get("/api/disassembly/nomenclature", dependencies=[Depends(require_auth)])
def get_disassembly_nomenclature_api():
    """Список всех наименований номенклатуры из разборки (для копирования в 1С)."""
    return {"items": db.get_disassembly_nomenclature_list()}


@app.get("/api/disassembly/missing-prices", dependencies=[Depends(require_auth)])
def get_disassembly_missing_prices_api():
    """Номенклатура без загруженной себестоимости (для страницы «Проверка стоимости»). Всегда JSON."""
    try:
        items = db.get_disassembly_missing_prices()
        return {"items": items}
    except Exception as e:
        return JSONResponse(
            {"items": [], "error": str(e)},
            status_code=200,
        )


@app.get("/api/disassembly/full-detail", dependencies=[Depends(require_auth)])
def get_disassembly_full_detail_api(date_str: str):
    """Полная детализация за день: остаток на начало, поступление на склад, после разборки, списание, отгрузка — по номенклатуре (штуки и рубли)."""
    return db.get_disassembly_full_detail_by_date(date_str)


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
    employee_prefix = os.environ.get("GOOGLE_DRIVE_PREFIX_EMPLOYEE_OUTPUT", "Выработка сотрудников")
    recursive = os.environ.get("GOOGLE_DRIVE_RECURSIVE", "true").lower() in ("1", "true", "yes")
    disassembly_raw = os.environ.get("GOOGLE_DRIVE_PREFIXES_DISASSEMBLY", "")
    disassembly_prefixes = [p.strip() for p in disassembly_raw.split(",") if p.strip()] if disassembly_raw else [
        "001", "002", "003", "004",
        "001 Перемещение возвратов на склад разборки LUMINARC",
        "002 Поступление ингредиентов после разбора на склад разборки LUMINARC",
        "003 Списание битой посуды со склада LUMINARC",
        "004 Перемещение со склада разборки LUMINARC на основной склад",
    ]
    if not folder_id or not credentials:
        res = {
            "ok": False,
            "error": "Задайте GOOGLE_DRIVE_FOLDER_ID и GOOGLE_DRIVE_CREDENTIALS_JSON",
            "downloaded": [],
            "errors": [],
        }
        try:
            import sync_log
            sync_log.log_sync("admin", res)
        except Exception:
            pass
        return res
    import gdrive_sync
    import sync_log
    res = gdrive_sync.sync_from_gdrive(
        folder_id=folder_id,
        credentials_json=credentials,
        prefix=prefix.strip(),
        recursive=recursive,
        employee_prefix=employee_prefix.strip() or None,
        disassembly_prefixes=disassembly_prefixes,
    )
    sync_log.log_sync("admin", res)
    return res


@app.get("/api/admin/sync-log", dependencies=[Depends(require_admin)])
def admin_sync_log():
    """Лог запусков синхронизации с Google Drive (последние 100 записей)."""
    import sync_log
    return {"entries": sync_log.get_sync_log()}


@app.get("/api/admin/refresh", dependencies=[Depends(require_admin)])
def admin_refresh():
    """Пересчитать данные из файлов по новым правилам (только для admin)."""
    db.refresh_data()
    return {"status": "ok"}


@app.post("/api/admin/replace-disassembly", dependencies=[Depends(require_admin)])
async def admin_replace_disassembly(
    file_001: UploadFile = File(..., description="001 — Перемещение возвратов на склад разборки"),
    file_002: UploadFile = File(..., description="002 — Поступление ингредиентов после разбора"),
    file_003: UploadFile = File(..., description="003 — Списание битой посуды"),
    file_004: UploadFile = File(..., description="004 — Перемещение на основной склад"),
):
    """
    Перезаписать все данные разборки возвратов четырьмя файлами.
    Удаляются все текущие файлы разборки (001–004), затем сохраняются загруженные 4 файла.
    Возвращает log — список сообщений для отображения в окне логов.
    """
    from datetime import datetime
    log = []
    try:
        from disassembly_parser import list_disassembly_file_paths
    except ImportError:
        return JSONResponse({"error": "Модуль разборки недоступен", "log": log}, status_code=500)
    data_dir = db.get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    for f in (file_001, file_002, file_003, file_004):
        if not f.filename or not f.filename.lower().endswith((".xlsx", ".xls")):
            log.append("Ошибка: все 4 файла должны быть Excel (.xlsx или .xls)")
            return {"error": "Все 4 файла должны быть Excel (.xlsx или .xls)", "log": log}
    log.append("Удаление старых файлов разборки...")
    to_delete = list_disassembly_file_paths(str(data_dir))
    if not to_delete:
        log.append("  Файлов разборки не найдено.")
    for p in to_delete:
        try:
            p.unlink()
            log.append(f"  Удалено: {p.name}")
        except Exception as e:
            log.append(f"  Ошибка удаления {p.name}: {e}")
            return {"error": f"Не удалось удалить {p.name}: {e}", "log": log}
    log.append(f"Удалено файлов: {len(to_delete)}")
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    log.append("Загрузка новых файлов...")
    try:
        for prefix, upl in [("001", file_001), ("002", file_002), ("003", file_003), ("004", file_004)]:
            content = await upl.read()
            if len(content) > 50 * 1024 * 1024:
                log.append(f"  Файл {prefix}: слишком большой (макс. 50 МБ)")
                return {"error": f"Файл {prefix} слишком большой (макс. 50 МБ)", "log": log}
            fname = f"{prefix}_reload_{ts}.xlsx"
            (data_dir / fname).write_bytes(content)
            log.append(f"  Сохранён: {fname} ({len(content) // 1024} КБ)")
    except Exception as e:
        log.append(f"  Ошибка: {e}")
        return {"error": str(e), "log": log}
    log.append("Пересчёт данных (refresh_data)...")
    db.refresh_data()
    log.append("Готово. Данные разборки перезагружены.")
    return {"status": "ok", "message": "Данные разборки перезагружены", "log": log}


@app.get("/api/admin/data-dates", dependencies=[Depends(require_admin)])
def admin_data_dates():
    """Диагностика: какие даты есть в данных (для отладки пропавших 1–2 января)."""
    return db.get_data_date_range()


@app.get("/api/admin/data-sources", dependencies=[Depends(require_admin)])
def admin_data_sources():
    """Какие файлы 001–004, цены, выработка, выпуск загружены и выведены в аналитику (файл, строки, дат)."""
    return db.get_data_sources_status()


@app.get("/api/admin/login-history", dependencies=[Depends(require_admin)])
def admin_login_history():
    """История входов: кто, когда, сколько раз. Только для admin."""
    return auth.get_login_history()


@app.get("/api/employees", dependencies=[Depends(require_auth)])
def get_employees_list():
    """Список ФИО сотрудников (из данных выработки)."""
    return {"employees": db.get_employee_names()}


@app.get("/api/employees/stats", dependencies=[Depends(require_auth)])
def get_employee_stats(user: str = "", date_from: str = "", date_to: str = ""):
    """Статистика по сотруднику за период: даты выхода, участки, продукция."""
    from datetime import datetime
    if not user or not date_from or not date_to:
        return {"error": "Укажите user, date_from и date_to (YYYY-MM-DD)"}
    try:
        d_from = datetime.strptime(date_from, "%Y-%m-%d").date()
        d_to = datetime.strptime(date_to, "%Y-%m-%d").date()
    except ValueError:
        return {"error": "Формат дат: YYYY-MM-DD"}
    if d_from > d_to:
        return {"error": "Дата начала не может быть позже даты конца"}
    return db.get_employee_period_stats(user.strip(), d_from, d_to)


@app.get("/api/departments", dependencies=[Depends(require_auth)])
def get_departments_list():
    """Список участков (production, department) из выработки."""
    return {"departments": db.get_department_list()}


@app.get("/api/departments/stats", dependencies=[Depends(require_auth)])
def get_department_stats(production: str = "", department: str = "", date_from: str = "", date_to: str = ""):
    """Статистика по участку за период: сотрудники, продукция, выходы по дням, часы, средний выпуск в час."""
    from datetime import datetime
    if not production or not department or not date_from or not date_to:
        return {"error": "Укажите production, department, date_from и date_to (YYYY-MM-DD)"}
    try:
        d_from = datetime.strptime(date_from, "%Y-%m-%d").date()
        d_to = datetime.strptime(date_to, "%Y-%m-%d").date()
    except ValueError:
        return {"error": "Формат дат: YYYY-MM-DD"}
    if d_from > d_to:
        return {"error": "Дата начала не может быть позже даты конца"}
    return db.get_department_period_stats(production.strip(), department.strip(), d_from, d_to)


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


# ─────────────────────────────────────────────────────────────────────────────
# Модуль «Графики и табели» (workforce)
# ─────────────────────────────────────────────────────────────────────────────
import workforce as wf


def _require_schedule_access(request: Request, production: Optional[str] = None) -> dict:
    """Проверяет, что пользователь имеет доступ к графикам/табелям.
    production — конкретное производство, к которому нужен доступ.
    Возвращает dict с role и production.
    """
    token = request.cookies.get("analytics_session")
    username = auth.get_username(token)
    if not username:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    access = auth.get_schedule_access(username)
    if access["role"] is None:
        raise HTTPException(status_code=403, detail="Нет доступа к модулю графиков")
    if production and access["production"] != "all" and access["production"] != production:
        raise HTTPException(status_code=403, detail="Нет доступа к данному производству")
    return access


# ── Справочник ────────────────────────────────────────────────────────────────

@app.get("/api/workforce/reference")
def wf_get_reference(request: Request):
    _require_schedule_access(request)
    return wf.get_reference()


def _get_request_username(request: Request) -> str:
    token = request.cookies.get("analytics_session")
    return auth.get_username(token) or "unknown"


@app.put("/api/workforce/reference")
async def wf_save_reference(request: Request):
    access = _require_schedule_access(request)
    if access["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Только менеджер или администратор")
    body = await request.json()
    entries = body if isinstance(body, list) else body.get("entries", [])
    wf.save_reference(entries)
    wf.log_change(_get_request_username(request), "справочник: сохранение", None, None, None, f"{len(entries)} записей")
    return {"ok": True, "count": len(entries)}


@app.post("/api/workforce/reference/import")
async def wf_import_reference(request: Request):
    """Импорт справочника из вставленного TSV (Google Таблицы)."""
    access = _require_schedule_access(request)
    if access["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Только менеджер или администратор")
    body = await request.json()
    tsv = body.get("tsv", "")
    if not tsv.strip():
        raise HTTPException(status_code=400, detail="Нет данных для импорта")
    entries = wf.import_reference_from_tsv(tsv)
    if not entries:
        raise HTTPException(status_code=400, detail="Не удалось распознать данные. Проверьте формат.")
    wf.save_reference(entries)
    wf.log_change(_get_request_username(request), "справочник: импорт", None, None, None, f"{len(entries)} записей")
    return {"ok": True, "count": len(entries), "entries": entries}


# ── График ────────────────────────────────────────────────────────────────────

@app.get("/api/workforce/schedule/{production}/{year}/{month}")
def wf_get_schedule(production: str, year: int, month: int, request: Request):
    if production not in wf.PRODUCTIONS:
        raise HTTPException(status_code=404, detail="Производство не найдено")
    _require_schedule_access(request, production)
    return wf.get_schedule(production, year, month)


@app.put("/api/workforce/schedule/{production}/{year}/{month}")
async def wf_save_schedule(production: str, year: int, month: int, request: Request):
    if production not in wf.PRODUCTIONS:
        raise HTTPException(status_code=404, detail="Производство не найдено")
    access = _require_schedule_access(request, production)
    if access["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Только менеджер или администратор")
    data = await request.json()
    emp_count = len(data.get("employees", []))
    wf.save_schedule(production, year, month, data)
    wf.log_change(_get_request_username(request), "график: сохранение", production, year, month, f"{emp_count} сотрудников")
    return {"ok": True}


@app.post("/api/workforce/schedule/{production}/{year}/{month}/import")
async def wf_import_schedule(production: str, year: int, month: int, request: Request):
    """Импорт графика из TSV (Google Таблицы)."""
    if production not in wf.PRODUCTIONS:
        raise HTTPException(status_code=404, detail="Производство не найдено")
    access = _require_schedule_access(request, production)
    if access["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Только менеджер или администратор")
    body = await request.json()
    tsv = body.get("tsv", "")
    if not tsv.strip():
        raise HTTPException(status_code=400, detail="Нет данных для импорта")
    schedule = wf.import_schedule_from_tsv(production, year, month, tsv)
    if not schedule.get("employees"):
        raise HTTPException(status_code=400, detail="Не удалось распознать данные. Проверьте формат.")
    wf.save_schedule(production, year, month, schedule)
    added = wf.merge_employees_from_schedule(production, schedule)
    wf.log_change(_get_request_username(request), "график: импорт", production, year, month, f"{len(schedule['employees'])} сотрудников, +{added} в список")
    return {"ok": True, "count": len(schedule["employees"]), "new_employees": added, "schedule": schedule}


# ── Табель ────────────────────────────────────────────────────────────────────

@app.get("/api/workforce/timesheet/{production}/{year}/{month}")
def wf_get_timesheet(production: str, year: int, month: int, request: Request):
    if production not in wf.PRODUCTIONS:
        raise HTTPException(status_code=404, detail="Производство не найдено")
    _require_schedule_access(request, production)
    return wf.get_timesheet(production, year, month)


@app.put("/api/workforce/timesheet/{production}/{year}/{month}")
async def wf_save_timesheet(production: str, year: int, month: int, request: Request):
    if production not in wf.PRODUCTIONS:
        raise HTTPException(status_code=404, detail="Производство не найдено")
    _require_schedule_access(request, production)
    data = await request.json()
    wf.save_timesheet(production, year, month, data)
    wf.log_change(_get_request_username(request), "табель: сохранение", production, year, month, "")
    return {"ok": True}


@app.patch("/api/workforce/timesheet/{production}/{year}/{month}/cell")
async def wf_update_timesheet_cell(production: str, year: int, month: int, request: Request):
    """Обновить одну ячейку табеля.
    Бригадиры могут редактировать только сегодняшний день.
    """
    if production not in wf.PRODUCTIONS:
        raise HTTPException(status_code=404, detail="Производство не найдено")
    access = _require_schedule_access(request, production)
    body = await request.json()
    emp_id = body.get("employee_id")
    day = str(body.get("day", ""))
    hours = body.get("hours")  # None = очистить
    if not emp_id or not day:
        raise HTTPException(status_code=400, detail="employee_id и day обязательны")

    # Бригадир может редактировать только сегодняшний день
    if access["role"] == "brigadier":
        from datetime import date as _date
        today = _date.today()
        if today.year != year or today.month != month or str(today.day) != day:
            raise HTTPException(
                status_code=403,
                detail=f"Бригадир может вносить данные только за сегодняшний день ({today.day} {today.month} {today.year})"
            )
    ts = wf.update_timesheet_cell(production, year, month, emp_id, day, hours)
    # Логируем: находим ФИО сотрудника из графика
    try:
        sched = wf.get_schedule(production, year, month)
        emp = next((e for e in sched.get("employees", []) if e["id"] == emp_id), None)
        emp_name = emp["full_name"] if emp else emp_id[:8]
    except Exception:
        emp_name = emp_id[:8]
    val_str = f"{hours}ч" if hours is not None else "очищено"
    wf.log_change(_get_request_username(request), "табель: ячейка", production, year, month,
                  f"{emp_name}, день {day}: {val_str}")
    return {"ok": True, "records": ts.get("records", {})}


# ── Комбинированный импорт График + Табель ───────────────────────────────────

@app.post("/api/workforce/combined-import/{production}/{year}/{month}")
async def wf_combined_import(production: str, year: int, month: int, request: Request):
    """
    Импорт графика И табеля одновременно из одной таблицы Google Sheets.
    Формат: ФИО | Должность | Статус | план_д1 | факт_д1 | план_д2 | факт_д2 | ...
    """
    if production not in wf.PRODUCTIONS:
        raise HTTPException(status_code=404, detail="Производство не найдено")
    access = _require_schedule_access(request, production)
    if access["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Только менеджер или администратор")

    body = await request.json()
    tsv = body.get("tsv", "")
    if not tsv.strip():
        raise HTTPException(status_code=400, detail="Нет данных для импорта")

    schedule, timesheet = wf.import_combined_from_tsv(production, year, month, tsv)

    if schedule is None or not schedule.get("employees"):
        raise HTTPException(
            status_code=400,
            detail="Не удалось распознать данные. Проверьте формат: строка заголовка должна содержать числа дней (1, 2, 3…), а данные — парами (план | факт) для каждого дня."
        )

    wf.save_schedule(production, year, month, schedule)
    wf.save_timesheet(production, year, month, timesheet)
    added = wf.merge_employees_from_schedule(production, schedule)
    wf.log_change(_get_request_username(request), "импорт график+табель", production, year, month,
                  f"{len(schedule['employees'])} сотрудников, +{added} в список")

    ts_filled = sum(1 for v in timesheet.get("records", {}).values() if v)
    return {
        "ok": True,
        "employees": len(schedule["employees"]),
        "timesheet_filled": ts_filled,
        "schedule": schedule,
        "timesheet": timesheet,
    }


# ── Список сотрудников производства ──────────────────────────────────────────

@app.get("/api/workforce/employees/{production}")
def wf_get_employees(production: str, request: Request):
    if production not in wf.PRODUCTIONS:
        raise HTTPException(status_code=404, detail="Производство не найдено")
    _require_schedule_access(request, production)
    return wf.get_employees(production)


@app.put("/api/workforce/employees/{production}")
async def wf_save_employees(production: str, request: Request):
    if production not in wf.PRODUCTIONS:
        raise HTTPException(status_code=404, detail="Производство не найдено")
    access = _require_schedule_access(request, production)
    if access["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Только менеджер или администратор")
    data = await request.json()
    employees = data if isinstance(data, list) else data.get("employees", [])
    wf.save_employees(production, employees)
    return {"ok": True, "count": len(employees)}


@app.post("/api/workforce/employees/{production}/import")
async def wf_import_employees(production: str, request: Request):
    """Импорт списка сотрудников из TSV (Google Таблицы): ФИО | Должность | Статус."""
    if production not in wf.PRODUCTIONS:
        raise HTTPException(status_code=404, detail="Производство не найдено")
    access = _require_schedule_access(request, production)
    if access["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Только менеджер или администратор")
    body = await request.json()
    tsv = body.get("tsv", "")
    if not tsv.strip():
        raise HTTPException(status_code=400, detail="Нет данных для импорта")
    employees = wf.import_employees_from_tsv(production, tsv)
    if not employees:
        raise HTTPException(status_code=400, detail="Не удалось распознать данные. Проверьте формат.")
    # Можно добавить к существующим или заменить — режим передаётся в теле
    mode = body.get("mode", "replace")  # "replace" или "append"
    if mode == "append":
        existing = wf.get_employees(production)
        employees = existing + employees
    wf.save_employees(production, employees)
    return {"ok": True, "count": len(employees), "employees": employees}


@app.delete("/api/workforce/employees/{production}/{employee_id}")
def wf_delete_employee(production: str, employee_id: str, request: Request):
    if production not in wf.PRODUCTIONS:
        raise HTTPException(status_code=404, detail="Производство не найдено")
    access = _require_schedule_access(request, production)
    if access["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Только менеджер или администратор")
    employees = wf.get_employees(production)
    updated = [e for e in employees if e.get("id") != employee_id]
    wf.save_employees(production, updated)
    return {"ok": True, "count": len(updated)}


@app.patch("/api/workforce/employees/{production}/{employee_id}/fire")
async def wf_fire_employee(production: str, employee_id: str, request: Request):
    """Уволить сотрудника: пометить дату и удалить из будущих графиков."""
    if production not in wf.PRODUCTIONS:
        raise HTTPException(status_code=404, detail="Производство не найдено")
    access = _require_schedule_access(request, production)
    if access["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Только менеджер или администратор")
    from datetime import date
    body = await request.json()
    fired_at = body.get("fired_at", date.today().isoformat())
    result = wf.fire_employee(production, employee_id, fired_at)
    wf.log_change(_get_request_username(request), "сотрудник: увольнение", production, None, None,
                  f"{result.get('emp_name', employee_id)} с {fired_at}")
    return result


@app.patch("/api/workforce/employees/{production}/{employee_id}/reinstate")
def wf_reinstate_employee(production: str, employee_id: str, request: Request):
    """Восстановить уволенного сотрудника."""
    if production not in wf.PRODUCTIONS:
        raise HTTPException(status_code=404, detail="Производство не найдено")
    access = _require_schedule_access(request, production)
    if access["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Только менеджер или администратор")
    result = wf.reinstate_employee(production, employee_id)
    wf.log_change(_get_request_username(request), "сотрудник: восстановление", production, None, None,
                  employee_id[:12])
    return result


# ── Журнал изменений ─────────────────────────────────────────────────────────

@app.get("/api/workforce/changelog")
def wf_changelog(request: Request, limit: int = 200):
    """Журнал изменений графиков и табелей. Только для администратора."""
    token = request.cookies.get("analytics_session")
    username = auth.get_username(token)
    if not username:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    if not auth.is_admin(username):
        raise HTTPException(status_code=403, detail="Только для администратора")
    return {"entries": wf.get_changelog(limit)}


# ── Аналитика ─────────────────────────────────────────────────────────────────

@app.get("/api/workforce/analytics/{year}/{month}")
def wf_analytics(year: int, month: int, request: Request):
    """Сводная аналитика по всем производствам за месяц. Только admin."""
    token = request.cookies.get("analytics_session")
    username = auth.get_username(token)
    if not username:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    if not auth.is_admin(username):
        raise HTTPException(status_code=403, detail="Только для администратора")
    return wf.get_monthly_analytics(year, month)


@app.get("/api/workforce/analytics/{year}/{month}/{day}")
def wf_day_analytics(year: int, month: int, day: int, request: Request):
    """Аналитика за конкретный день. Только admin."""
    token = request.cookies.get("analytics_session")
    username = auth.get_username(token)
    if not username:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    if not auth.is_admin(username):
        raise HTTPException(status_code=403, detail="Только для администратора")
    return wf.get_day_analytics(year, month, day)


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
