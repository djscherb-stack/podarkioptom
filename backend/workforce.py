"""Управление табелями, графиками работы и справочниками."""

import json
import os
import uuid
import calendar
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
WORKFORCE_DIR = DATA_DIR / "workforce"

PRODUCTIONS = {
    "tea": "ЧАЙ",
    "engraving": "ГРАВИРОВКА",
    "luminarc": "ЛЮМИНАРК",
}


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


# ─── Журнал изменений ────────────────────────────────────────────────────────

def _changelog_path() -> Path:
    return WORKFORCE_DIR / "changelog.json"


def _get_changelog() -> list:
    _ensure_dir()
    return _read_json(_changelog_path(), [])


def log_change(username: str, action: str, production: Optional[str], year: Optional[int], month: Optional[int], details: str = "") -> None:
    """Записать событие редактирования в журнал (хранит последние 2000 записей)."""
    try:
        log = _get_changelog()
        log.append({
            "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "username": username,
            "action": action,
            "production": production,
            "year": year,
            "month": month,
            "details": details,
        })
        _write_json(_changelog_path(), log[-2000:])
    except Exception:
        pass


def get_changelog(limit: int = 200) -> list:
    """Вернуть последние N записей журнала в обратном порядке (новые сверху)."""
    log = _get_changelog()
    return log[-limit:][::-1]


# ─── Справочник ───────────────────────────────────────────────────────────────

def get_reference() -> list:
    _ensure_dir()
    return _read_json(WORKFORCE_DIR / "reference.json", [])


def save_reference(entries: list) -> None:
    _write_json(WORKFORCE_DIR / "reference.json", entries)


def _parse_rate(val: str):
    """Парсит числовое значение ставки. Возвращает float или None если не число/«х»."""
    v = val.strip().replace(",", ".").replace(" ", "").replace("\xa0", "")
    if not v or v.lower() in ("х", "x", "-", "—", "нет", "n/a"):
        return None
    try:
        return float(v)
    except Exception:
        return None


def import_reference_from_tsv(tsv: str) -> list:
    """
    Парсинг вставленных данных из Google Таблиц.
    Поддерживает два формата:

    Формат 1 — горизонтальный (статусы как заголовки столбцов):
      Должность | штат | найм | Астамиров | Универсал М | ГПХ
      Оператор  | 484  | 484  | 610       | х           | 484

    Формат 2 — вертикальный (одна строка = одна запись):
      Должность | Статус | Ставка/час
      Оператор  | штат   | 484

    Формат определяется автоматически по первой строке.
    «х» / «x» в ячейке = данный статус недоступен для этой должности.
    """
    lines = [l for l in tsv.strip().splitlines() if l.strip()]
    if not lines:
        return []

    first_cols = [c.strip() for c in lines[0].split("\t")]

    # ── Формат 1: заголовочная строка со статусами ────────────────────────────
    # Признак: первый столбец == "Должность" и 2+ столбца не похожи на "Статус"
    if (first_cols[0].lower() == "должность" and
            len(first_cols) >= 3 and
            first_cols[1].lower() not in ("статус", "status")):

        statuses = first_cols[1:]   # заголовки статусов (столбцы B, C, D, ...)
        result = []
        for line in lines[1:]:
            cols = [c.strip() for c in line.split("\t")]
            if not cols or not cols[0]:
                continue
            position = cols[0]
            for i, status in enumerate(statuses):
                if not status:
                    continue
                val = cols[i + 1] if (i + 1) < len(cols) else ""
                rate = _parse_rate(val)
                if rate is not None:
                    result.append({"position": position, "status": status, "hourly_rate": rate})
        return result

    # ── Формат 2: вертикальный (Должность | Статус | Ставка) ──────────────────
    result = []
    for line in lines:
        cols = [c.strip() for c in line.split("\t")]
        if len(cols) < 3:
            continue
        pos, status, rate_str = cols[0], cols[1], cols[2]
        if pos.lower() in ("должность", "position"):
            continue
        if not pos or not status:
            continue
        rate = _parse_rate(rate_str)
        if rate is None:
            rate = 0.0
        result.append({"position": pos, "status": status, "hourly_rate": rate})
    return result


# ─── График (Schedule) ────────────────────────────────────────────────────────

def _schedule_path(production: str, year: int, month: int) -> Path:
    return WORKFORCE_DIR / f"schedule_{production}_{year}_{month:02d}.json"


def get_schedule(production: str, year: int, month: int) -> dict:
    _ensure_dir()
    default = {"production": production, "year": year, "month": month, "employees": []}
    return _read_json(_schedule_path(production, year, month), default)


def save_schedule(production: str, year: int, month: int, data: dict) -> None:
    data["production"] = production
    data["year"] = year
    data["month"] = month
    _write_json(_schedule_path(production, year, month), data)


def import_schedule_from_tsv(production: str, year: int, month: int, tsv: str) -> dict:
    """
    Парсинг вставленных данных из Google Таблиц.
    Ожидаемые столбцы: ФИО | Должность | Статус | 1 | 2 | ... | 31
    Значения в ячейках дней: число часов, "+" (= 8ч), "в" или "В" (выходной = 0), пусто = не работает.
    Первая строка может быть заголовком — пропускается автоматически.
    """
    lines = [l for l in tsv.strip().splitlines() if l.strip()]
    if not lines:
        return {"production": production, "year": year, "month": month, "employees": []}

    # Определяем, есть ли заголовок (первый столбец — нечисловое слово типа "ФИО")
    start_idx = 0
    first_col = lines[0].split("\t")[0].strip().lower()
    if first_col in ("фио", "ф.и.о.", "ф.и.о", "имя", "сотрудник", "name", "full_name"):
        start_idx = 1

    employees = []
    for line in lines[start_idx:]:
        cols = [c.strip() for c in line.split("\t")]
        if len(cols) < 1:
            continue
        full_name = cols[0]
        if not full_name:
            continue
        position = cols[1] if len(cols) > 1 else ""
        status = cols[2] if len(cols) > 2 else ""

        working_days = {}
        for i in range(3, len(cols)):
            day = i - 2  # столбец 3 (индекс 3) = день 1
            val = cols[i].replace(",", ".").replace("\xa0", "").strip()
            if not val:
                continue
            if val.lower() in ("в", "выходной", "х", "-"):
                continue  # выходной — не рабочий
            if val in ("+", "р", "Р", "р.", "Р."):
                working_days[str(day)] = 8.0
                continue
            try:
                hours = float(val)
                if hours > 0:
                    working_days[str(day)] = hours
            except Exception:
                # Любой непустой маркер = 8 часов
                working_days[str(day)] = 8.0

        employees.append({
            "id": str(uuid.uuid4()),
            "full_name": full_name,
            "position": position,
            "status": status,
            "working_days": working_days,
        })

    return {"production": production, "year": year, "month": month, "employees": employees}


# ─── Табель (Timesheet) ────────────────────────────────────────────────────────

def _timesheet_path(production: str, year: int, month: int) -> Path:
    return WORKFORCE_DIR / f"timesheet_{production}_{year}_{month:02d}.json"


def get_timesheet(production: str, year: int, month: int) -> dict:
    _ensure_dir()
    default = {"production": production, "year": year, "month": month, "records": {}}
    return _read_json(_timesheet_path(production, year, month), default)


def save_timesheet(production: str, year: int, month: int, data: dict) -> None:
    data["production"] = production
    data["year"] = year
    data["month"] = month
    _write_json(_timesheet_path(production, year, month), data)


def update_timesheet_cell(
    production: str, year: int, month: int,
    employee_id: str, day: str, hours: Optional[float]
) -> dict:
    """Обновить один день в табеле для сотрудника."""
    ts = get_timesheet(production, year, month)
    records = ts.get("records", {})
    if hours is None:
        records.get(employee_id, {}).pop(day, None)
    else:
        if employee_id not in records:
            records[employee_id] = {}
        records[employee_id][day] = hours
    ts["records"] = records
    save_timesheet(production, year, month, ts)
    return ts


# ─── Аналитика ────────────────────────────────────────────────────────────────

def _empty_day_dict(num_days: int) -> dict:
    return {str(d): 0 for d in range(1, num_days + 1)}


def _empty_cost_dict(num_days: int) -> dict:
    return {str(d): 0.0 for d in range(1, num_days + 1)}


def get_monthly_analytics(year: int, month: int) -> dict:
    """Расширенная аналитика: по дням (план/факт) с разбивкой по производствам и статусам."""
    reference = get_reference()
    rate_lookup = {(r["position"], r["status"]): r["hourly_rate"] for r in reference}
    num_days = calendar.monthrange(year, month)[1]

    result = {}
    for prod in PRODUCTIONS:
        schedule = get_schedule(prod, year, month)
        timesheet = get_timesheet(prod, year, month)
        employees = schedule.get("employees", [])
        ts_records = timesheet.get("records", {})

        # Итого по производству
        daily_planned      = _empty_day_dict(num_days)
        daily_actual       = _empty_day_dict(num_days)
        daily_planned_cost = _empty_cost_dict(num_days)
        daily_actual_cost  = _empty_cost_dict(num_days)

        total_planned_cost  = 0.0
        total_actual_cost   = 0.0
        total_planned_hours = 0.0
        total_actual_hours  = 0.0
        status_counts: dict = {}

        # По статусам
        st_emp_count:        dict[str, int]   = {}
        st_daily_planned:    dict[str, dict]  = {}
        st_daily_actual:     dict[str, dict]  = {}
        st_daily_plan_cost:  dict[str, dict]  = {}
        st_daily_fact_cost:  dict[str, dict]  = {}
        st_total_plan_cost:  dict[str, float] = {}
        st_total_fact_cost:  dict[str, float] = {}

        for emp in employees:
            emp_id   = emp["id"]
            position = emp.get("position", "")
            status   = emp.get("status", "")
            rate     = rate_lookup.get((position, status), 0.0)
            working_days: dict = emp.get("working_days", {})
            ts_emp:  dict = ts_records.get(emp_id, {})

            status_counts[status] = status_counts.get(status, 0) + 1
            st_emp_count[status]  = st_emp_count.get(status, 0) + 1

            # Инициализация статусных словарей
            if status not in st_daily_planned:
                st_daily_planned[status]   = _empty_day_dict(num_days)
                st_daily_actual[status]    = _empty_day_dict(num_days)
                st_daily_plan_cost[status] = _empty_cost_dict(num_days)
                st_daily_fact_cost[status] = _empty_cost_dict(num_days)
                st_total_plan_cost[status] = 0.0
                st_total_fact_cost[status] = 0.0

            # 1) Запланированные дни (план + факт по табелю)
            for day_str, planned_h in working_days.items():
                cost = planned_h * rate
                # Итого по производству
                daily_planned[day_str]      += 1
                daily_planned_cost[day_str] += cost
                total_planned_cost          += cost
                total_planned_hours         += planned_h
                # По статусу
                st_daily_planned[status][day_str]   += 1
                st_daily_plan_cost[status][day_str] += cost
                st_total_plan_cost[status]          += cost

                actual_h = ts_emp.get(day_str)
                if actual_h is not None:
                    actual_cost = actual_h * rate
                    if actual_h > 0:
                        daily_actual[day_str]                += 1
                        st_daily_actual[status][day_str]     += 1
                    daily_actual_cost[day_str]               += actual_cost
                    st_daily_fact_cost[status][day_str]      += actual_cost
                    total_actual_cost                        += actual_cost
                    total_actual_hours                       += actual_h
                    st_total_fact_cost[status]               += actual_cost

            # 2) Внеплановые дни: в табеле есть часы, но дня нет в графике — учитываем в факте
            for day_str, actual_h in ts_emp.items():
                if day_str in working_days:
                    continue  # уже учтено выше
                if actual_h is None or actual_h <= 0:
                    continue
                try:
                    d = int(day_str)
                    if d < 1 or d > num_days:
                        continue  # день вне месяца
                except (ValueError, TypeError):
                    continue
                actual_cost = actual_h * rate
                daily_actual[day_str]               += 1
                daily_actual_cost[day_str]            += actual_cost
                st_daily_actual[status][day_str]     += 1
                st_daily_fact_cost[status][day_str]  += actual_cost
                total_actual_cost                     += actual_cost
                total_actual_hours                    += actual_h
                st_total_fact_cost[status]            += actual_cost

        result[prod] = {
            "name": PRODUCTIONS[prod],
            "total_employees": len(employees),
            "status_counts":   status_counts,
            "daily_planned":   daily_planned,
            "daily_actual":    daily_actual,
            "daily_planned_cost": daily_planned_cost,
            "daily_actual_cost":  daily_actual_cost,
            "total_planned_cost":  total_planned_cost,
            "total_actual_cost":   total_actual_cost,
            "total_planned_hours": total_planned_hours,
            "total_actual_hours":  total_actual_hours,
            # Разбивка по статусам
            "status_employee_count":    st_emp_count,
            "status_daily_planned":     st_daily_planned,
            "status_daily_actual":      st_daily_actual,
            "status_daily_plan_cost":   st_daily_plan_cost,
            "status_daily_fact_cost":   st_daily_fact_cost,
            "status_total_plan_cost":   st_total_plan_cost,
            "status_total_fact_cost":   st_total_fact_cost,
        }

    return {"year": year, "month": month, "productions": result}


def get_day_analytics(year: int, month: int, day: int) -> dict:
    """Аналитика по конкретному дню: план/факт по всем производствам."""
    reference = get_reference()
    rate_lookup = {(r["position"], r["status"]): r["hourly_rate"] for r in reference}
    day_str = str(day)
    result = {}

    for prod in PRODUCTIONS:
        schedule = get_schedule(prod, year, month)
        timesheet = get_timesheet(prod, year, month)
        employees = schedule.get("employees", [])
        ts_records = timesheet.get("records", {})

        planned_count = 0
        actual_count = 0
        planned_cost = 0.0
        actual_cost = 0.0

        for emp in employees:
            emp_id = emp["id"]
            position = emp.get("position", "")
            status = emp.get("status", "")
            rate = rate_lookup.get((position, status), 0.0)
            working_days = emp.get("working_days", {})
            ts_emp = ts_records.get(emp_id, {})

            if day_str in working_days:
                planned_count += 1
                planned_cost += working_days[day_str] * rate

            actual_h = ts_emp.get(day_str)
            if actual_h is not None and actual_h > 0:
                actual_count += 1
                actual_cost += actual_h * rate

        result[prod] = {
            "name": PRODUCTIONS[prod],
            "planned_count": planned_count,
            "actual_count": actual_count,
            "planned_cost": planned_cost,
            "actual_cost": actual_cost,
        }

    return {"year": year, "month": month, "day": day, "productions": result}


# ─── Комбинированный импорт «График + Табель» ────────────────────────────────

def import_combined_from_tsv(production: str, year: int, month: int, tsv: str):
    """
    Импорт графика И табеля из одной таблицы Google Sheets.

    Формат:
      Строка 1 (заголовок): ФИО | Должность | Статус | 1 | (пусто) | 2 | (пусто) | 3 | ...
        — число = день месяца; следующая за ним пустая колонка = факт для того же дня.
      Строки 2+: ФИО | Должность | Статус | план_д1 | факт_д1 | план_д2 | факт_д2 | ...

    Возвращает (schedule_dict, timesheet_dict) или (None, None) при ошибке.
    """
    lines = tsv.strip().splitlines()
    # Убираем полностью пустые строки, но оставляем строку заголовка
    non_empty = [l for l in lines if l.strip()]
    if len(non_empty) < 2:
        return None, None

    header = [c.strip() for c in non_empty[0].split("\t")]

    # Строим карту столбцов: index -> (day_num, 'plan'|'fact')
    # Правило: если header[i] — целое число, это «план» для того дня,
    # а header[i+1] (обычно пустой) — «факт».
    col_map: dict[int, tuple[int, str]] = {}
    i = 3
    while i < len(header):
        val = header[i].strip()
        if val and val.isdigit():
            day = int(val)
            if 1 <= day <= 31:
                col_map[i] = (day, "plan")
                col_map[i + 1] = (day, "fact")
            i += 2
        else:
            i += 1

    if not col_map:
        return None, None

    employees = []
    ts_records: dict[str, dict] = {}

    for line in non_empty[1:]:
        cols = [c.strip() for c in line.split("\t")]
        if not cols or not cols[0]:
            continue
        full_name = cols[0]
        position = cols[1] if len(cols) > 1 else ""
        status   = cols[2] if len(cols) > 2 else ""

        emp_id = str(uuid.uuid4())
        working_days: dict[str, float] = {}
        ts_emp: dict[str, float] = {}

        for col_idx, (day, typ) in col_map.items():
            if col_idx >= len(cols):
                continue
            raw = cols[col_idx].replace(",", ".").replace("\xa0", "").strip()
            if not raw:
                continue
            try:
                hours = float(raw)
            except ValueError:
                continue
            if hours <= 0:
                continue
            if typ == "plan":
                working_days[str(day)] = hours
            else:
                ts_emp[str(day)] = hours

        if not working_days and not ts_emp:
            continue

        employees.append({
            "id": emp_id,
            "full_name": full_name,
            "position": position,
            "status": status,
            "working_days": working_days,
        })
        if ts_emp:
            ts_records[emp_id] = ts_emp

    schedule  = {"production": production, "year": year, "month": month, "employees": employees}
    timesheet = {"production": production, "year": year, "month": month, "records": ts_records}
    return schedule, timesheet


# ─── Список сотрудников производства ─────────────────────────────────────────

def _employees_path(production: str) -> Path:
    return WORKFORCE_DIR / f"employees_{production}.json"


def get_employees(production: str) -> list:
    """Постоянный список сотрудников производства (не привязан к месяцу)."""
    _ensure_dir()
    return _read_json(_employees_path(production), [])


def save_employees(production: str, employees: list) -> None:
    _write_json(_employees_path(production), employees)


def merge_employees_from_schedule(production: str, schedule: dict) -> int:
    """
    После импорта графика — добавить новых сотрудников в список производства.
    Сопоставление по ФИО. Возвращает кол-во добавленных.
    """
    existing = get_employees(production)
    existing_names = {e["full_name"].strip().lower() for e in existing}
    added = []
    for emp in schedule.get("employees", []):
        name = emp.get("full_name", "").strip()
        if not name:
            continue
        if name.lower() not in existing_names:
            added.append({
                "id": str(uuid.uuid4()),
                "full_name": name,
                "position": emp.get("position", ""),
                "status": emp.get("status", ""),
            })
            existing_names.add(name.lower())
    if added:
        save_employees(production, existing + added)
    return len(added)


def fire_employee(production: str, employee_id: str, fired_at: str) -> dict:
    """
    Уволить сотрудника: проставить дату увольнения и удалить из будущих графиков.
    fired_at — строка в формате YYYY-MM-DD.
    """
    from datetime import date as _date
    employees = get_employees(production)
    emp_name: Optional[str] = None
    for emp in employees:
        if emp.get("id") == employee_id:
            emp["fired_at"] = fired_at
            emp_name = emp.get("full_name", "")
            break
    save_employees(production, employees)

    # Удаляем из текущего и будущих 12 месяцев (по имени, т.к. UUID в графике другой)
    if emp_name:
        try:
            start = _date.fromisoformat(fired_at).replace(day=1)
        except ValueError:
            start = _date.today().replace(day=1)
        for i in range(13):
            m = start.month - 1 + i
            year = start.year + m // 12
            month = m % 12 + 1
            path = _schedule_path(production, year, month)
            if path.exists():
                sched = get_schedule(production, year, month)
                before = len(sched.get("employees", []))
                sched["employees"] = [
                    e for e in sched.get("employees", [])
                    if e.get("full_name", "").strip().lower() != emp_name.strip().lower()
                ]
                if len(sched["employees"]) < before:
                    save_schedule(production, year, month, sched)

    return {"ok": True, "fired_at": fired_at, "emp_name": emp_name}


def reinstate_employee(production: str, employee_id: str) -> dict:
    """Восстановить уволенного сотрудника."""
    employees = get_employees(production)
    for emp in employees:
        if emp.get("id") == employee_id:
            emp.pop("fired_at", None)
            break
    save_employees(production, employees)
    return {"ok": True}


def import_employees_from_tsv(production: str, tsv: str) -> list:
    """
    Парсинг вставленных данных из Google Таблиц.
    Формат: ФИО | Должность | Статус
    Первая строка может быть заголовком — пропускается автоматически.
    """
    lines = [l for l in tsv.strip().splitlines() if l.strip()]
    if not lines:
        return []

    result = []
    for line in lines:
        cols = [c.strip() for c in line.split("\t")]
        if not cols or not cols[0]:
            continue
        full_name = cols[0]
        # Пропускаем строку заголовка
        if full_name.lower() in ("фио", "ф.и.о.", "имя", "сотрудник", "name"):
            continue
        position = cols[1].strip() if len(cols) > 1 else ""
        status   = cols[2].strip() if len(cols) > 2 else ""
        phone    = cols[3].strip() if len(cols) > 3 else ""
        entry: dict = {
            "id": str(uuid.uuid4()),
            "full_name": full_name,
            "position": position,
            "status": status,
        }
        if phone:
            entry["phone"] = phone
        result.append(entry)
    return result
