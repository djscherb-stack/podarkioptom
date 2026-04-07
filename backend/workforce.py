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
    path = _schedule_path(production, year, month)
    default = {"production": production, "year": year, "month": month, "employees": []}

    # Если файл уже существует — возвращаем его как есть
    if path.exists():
        return _read_json(path, default)

    # Файл не существует → пробуем перенести сотрудников из предыдущего месяца
    prev_year, prev_month = (year, month - 1) if month > 1 else (year - 1, 12)
    prev = _read_json(_schedule_path(production, prev_year, prev_month), {})
    prev_employees = prev.get("employees", [])

    # Берём всех, кроме уволенных; рабочие дни сбрасываем в {}
    carried = [
        {
            "id": emp.get("id") or str(uuid.uuid4()),
            "full_name": emp["full_name"],
            "position": emp.get("position", ""),
            "status": emp.get("status", ""),
            "working_days": {},
            **({"phone": emp["phone"]} if emp.get("phone") else {}),
            **({"section": emp["section"]} if emp.get("section") else {}),
        }
        for emp in prev_employees
        if not emp.get("fired_at")
    ]

    return {"production": production, "year": year, "month": month, "employees": carried}


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


def _to_float(v, default: float = 0.0) -> float:
    """Безопасно конвертирует значение в float."""
    if v is None:
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def get_monthly_analytics(year: int, month: int) -> dict:
    """Расширенная аналитика: по дням (план/факт) с разбивкой по производствам и статусам."""
    reference = get_reference()
    rate_lookup = {}
    for r in reference:
        try:
            key = (r.get("position", ""), r.get("status", ""))
            rate_lookup[key] = _to_float(r.get("hourly_rate", 0))
        except Exception:
            pass
    num_days = calendar.monthrange(year, month)[1]

    result = {}
    for prod in PRODUCTIONS:
        schedule = get_schedule(prod, year, month)
        timesheet = get_timesheet(prod, year, month)
        employees = schedule.get("employees", []) if isinstance(schedule, dict) else []
        ts_records = timesheet.get("records", {}) if isinstance(timesheet, dict) else {}

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
        st_total_plan_hours: dict[str, float] = {}
        st_total_fact_hours: dict[str, float] = {}

        for emp in employees:
            if not isinstance(emp, dict):
                continue
            emp_id   = emp.get("id") or ""
            position = emp.get("position", "") or ""
            status   = emp.get("status", "") or ""
            rate     = rate_lookup.get((position, status), 0.0)
            working_days: dict = emp.get("working_days") or {}
            ts_emp:  dict = ts_records.get(emp_id) or {}

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
                st_total_plan_hours[status] = 0.0
                st_total_fact_hours[status] = 0.0

            # 1) Запланированные дни (план + факт по табелю)
            for day_str, planned_h_raw in working_days.items():
                # Защита от нечисловых значений и выхода за пределы месяца
                try:
                    d = int(day_str)
                    if d < 1 or d > num_days:
                        continue
                except (ValueError, TypeError):
                    continue
                planned_h = _to_float(planned_h_raw)
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
                st_total_plan_hours[status]         = st_total_plan_hours.get(status, 0.0) + planned_h

                actual_h_raw = ts_emp.get(day_str)
                if actual_h_raw is not None:
                    actual_h = _to_float(actual_h_raw)
                    actual_cost = actual_h * rate
                    if actual_h > 0:
                        daily_actual[day_str]                += 1
                        st_daily_actual[status][day_str]     += 1
                    daily_actual_cost[day_str]               += actual_cost
                    st_daily_fact_cost[status][day_str]      += actual_cost
                    total_actual_cost                        += actual_cost
                    total_actual_hours                       += actual_h
                    st_total_fact_cost[status]               += actual_cost
                    st_total_fact_hours[status]              = st_total_fact_hours.get(status, 0.0) + actual_h

            # 2) Внеплановые дни: в табеле есть часы, но дня нет в графике — учитываем в факте
            for day_str, actual_h_raw in ts_emp.items():
                if day_str in working_days:
                    continue  # уже учтено выше
                actual_h = _to_float(actual_h_raw)
                if actual_h <= 0:
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
            "status_total_plan_hours":  st_total_plan_hours,
            "status_total_fact_hours":  st_total_fact_hours,
        }

    return {"year": year, "month": month, "productions": result}


def get_day_analytics(year: int, month: int, day: int) -> dict:
    """Аналитика по конкретному дню: план/факт по всем производствам."""
    reference = get_reference()
    rate_lookup = {}
    for r in reference:
        try:
            key = (r.get("position", ""), r.get("status", ""))
            rate_lookup[key] = _to_float(r.get("hourly_rate", 0))
        except Exception:
            pass
    day_str = str(day)
    result = {}

    for prod in PRODUCTIONS:
        schedule = get_schedule(prod, year, month)
        timesheet = get_timesheet(prod, year, month)
        employees = schedule.get("employees", []) if isinstance(schedule, dict) else []
        ts_records = timesheet.get("records", {}) if isinstance(timesheet, dict) else {}

        planned_count = 0
        actual_count = 0
        planned_cost = 0.0
        actual_cost = 0.0

        for emp in employees:
            if not isinstance(emp, dict):
                continue
            emp_id = emp.get("id") or ""
            position = emp.get("position", "") or ""
            status = emp.get("status", "") or ""
            rate = rate_lookup.get((position, status), 0.0)
            working_days = emp.get("working_days") or {}
            ts_emp = ts_records.get(emp_id) or {}

            if day_str in working_days:
                planned_count += 1
                planned_cost += _to_float(working_days[day_str]) * rate

            actual_h = _to_float(ts_emp.get(day_str))
            if actual_h > 0:
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


def _infer_section_for_engraving(position: str) -> str:
    """
    Определить участок по должности.
    Правила: гравировщики→Гравировка, Резка МДФ→Резка МДФ, шелкографист→Шелкография,
    сборщик коробок→Сборка МДФ, упаковщик/комплектовщик→Сборочный цех, остальные→Вспомогательный персонал.
    """
    p = (position or "").lower().strip()
    if not p:
        return "Вспомогательный персонал"

    if "гравер" in p or "гравиров" in p or "лазер" in p:
        return "Гравировочный цех"
    if "резка" in p and "мдф" in p:
        return "Резка МДФ"
    if "шелкограф" in p:
        return "Шелкография"
    if "сборщик" in p and "короб" in p:
        return "Сборка МДФ"
    if ("сборка" in p or "сборщик" in p) and "мдф" in p:
        return "Сборка МДФ"
    if "упаков" in p:
        return "Сборочный цех"
    if "комплектовщ" in p:
        return "Сборочный цех"
    if "валков" in p or "пресс" in p:
        return "Валковый пресс"

    return "Вспомогательный персонал"


def _normalize_engraving_section(section: str) -> str:
    """
    Нормализация названия участка гравировки к каноническим именам карточек
    на дашборде (независимо от того, как он записан в списке сотрудников).
    """
    s = (section or "").strip()
    if not s:
        return "—"
    low = s.lower()

    # Гравировка
    if "гравиров" in low:
        return "Гравировка"

    # Резка МДФ
    if "резка" in low and "мдф" in low:
        return "Резка МДФ"

    # Сборка МДФ
    if "сборка" in low and "мдф" in low:
        return "Сборка МДФ"

    # Валковый пресс
    if "валков" in low or "пресс" in low:
        return "Валковый пресс"

    # Шелкография
    if "шелкограф" in low:
        return "Шелкография"

    # Выпуск готовой продукции / сборочный
    if "сбороч" in low or "выпуск" in low:
        return "Выпуск готовой продукции"

    # Вспомогательный персонал
    if any(k in low for k in ["руковод", "начальник", "мастер", "техник", "уборщ", "кладов", "оператор"]):
        return "Вспомогательный персонал"

    return s


def _infer_section_for_tea(position: str) -> str:
    """Определить участок по должности для ЧАЙ."""
    p = (position or "").lower().strip()
    if not p:
        return "Вспомогательный персонал"
    if "купаж" in p:
        return "Купажный цех"
    if "фасов" in p:
        return "Фасовочный цех"
    if "шелкограф" in p:
        return "Шелкография"
    if "картон" in p or "дерево" in p or "резка" in p or "мдф" in p:
        return "Картон/Дерево"
    if "сборочн" in p or "термо" in p or "туннель" in p or "упаков" in p:
        return "Сборочный цех"
    return "Вспомогательный персонал"


def _normalize_tea_section(section: str) -> str:
    """Нормализация участков чая к каноническим именам дашборда.
    Также переводит старые названия (Термотуннель, Упаковка) → Сборочный цех.
    """
    s = (section or "").strip()
    if not s:
        return "—"
    low = s.lower()
    if "купаж" in low:
        return "Купажный цех"
    if "фасов" in low:
        return "Фасовочный цех"
    if "шелкограф" in low:
        return "Шелкография"
    if "картон" in low or "дерево" in low or "мдф" in low:
        return "Картон/Дерево"
    if "сборочн" in low or "термо" in low or "туннель" in low or "упаков" in low:
        return "Сборочный цех"
    if any(k in low for k in ["вспомогател", "руковод", "начальник", "мастер"]):
        return "Вспомогательный персонал"
    return s or "—"


def _infer_section_for_luminarc(position: str) -> str:
    """Определить участок по должности для ЛЮМИНАРК."""
    p = (position or "").lower().strip()
    if not p:
        return "Вспомогательный персонал"
    if "склад" in p or "кладов" in p:
        return "Склад"
    if "комплект" in p:
        return "Комплекты"
    if "упаков" in p or "сборщ" in p or "сборка" in p:
        return "Упаковка"
    return "Вспомогательный персонал"


def assign_sections_for_tea() -> int:
    """Проставить участки всем сотрудникам чая по должности."""
    _ensure_dir()
    employees = _read_json(_employees_path("tea"), [])
    for emp in employees:
        emp["section"] = _infer_section_for_tea(emp.get("position", ""))
    save_employees("tea", employees)
    return len(employees)


def assign_sections_for_luminarc() -> int:
    """Проставить участки всем сотрудникам люминарка по должности."""
    _ensure_dir()
    employees = _read_json(_employees_path("luminarc"), [])
    for emp in employees:
        emp["section"] = _infer_section_for_luminarc(emp.get("position", ""))
    save_employees("luminarc", employees)
    return len(employees)


def get_employees(production: str) -> list:
    """Постоянный список сотрудников производства (не привязан к месяцу)."""
    _ensure_dir()
    employees = _read_json(_employees_path(production), [])
    _infer_fn = {
        "engraving": _infer_section_for_engraving,
        "tea": _infer_section_for_tea,
        "luminarc": _infer_section_for_luminarc,
    }.get(production)
    if _infer_fn and employees:
        changed = False
        for emp in employees:
            if not emp.get("section") or (emp.get("section", "").strip() == ""):
                sec = _infer_fn(emp.get("position", ""))
                if sec:
                    emp["section"] = sec
                    changed = True
        if changed:
            save_employees(production, employees)
    return employees


def save_employees(production: str, employees: list) -> None:
    _write_json(_employees_path(production), employees)


def assign_sections_for_engraving() -> int:
    """
    Проставить участки всем сотрудникам гравировки по должности.
    Возвращает количество сотрудников.
    """
    _ensure_dir()
    employees = _read_json(_employees_path("engraving"), [])
    for emp in employees:
        emp["section"] = _infer_section_for_engraving(emp.get("position", ""))
    save_employees("engraving", employees)
    return len(employees)


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
            position = emp.get("position", "")
            entry = {
                "id": str(uuid.uuid4()),
                "full_name": name,
                "position": position,
                "status": emp.get("status", ""),
            }
            if production == "engraving":
                sec = _infer_section_for_engraving(position)
                if sec:
                    entry["section"] = sec
            added.append(entry)
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


def get_workforce_period_data(production: str, date_from, date_to) -> dict:
    """Get employee count, total hours and costs for a production over a date range.
    Also returns per-section counts (if employees have the 'section' field set).
    """
    from datetime import date as _date

    reference = get_reference()
    rate_lookup = {(r["position"], r["status"]): r["hourly_rate"] for r in reference}

    # Determine which (year, month) pairs overlap the period
    months: set[tuple[int, int]] = set()
    cur = _date(date_from.year, date_from.month, 1)
    end = _date(date_to.year, date_to.month, 1)
    while cur <= end:
        months.add((cur.year, cur.month))
        if cur.month == 12:
            cur = _date(cur.year + 1, 1, 1)
        else:
            cur = _date(cur.year, cur.month + 1, 1)

    employees_set: set[str] = set()
    total_hours = 0.0
    total_cost  = 0.0
    daily_cost:      dict[str, float] = {}
    daily_employees: dict[str, set]   = {}
    use_schedule_fallback = False  # будет True если табель пуст

    for year, month in sorted(months):
        timesheet  = get_timesheet(production, year, month)
        schedule   = get_schedule(production, year, month)
        ts_records = timesheet.get("records", {})
        emp_by_id  = {e["id"]: e for e in schedule.get("employees", [])}

        for emp_id, days_dict in ts_records.items():
            emp = emp_by_id.get(emp_id)
            if not emp:
                continue
            position = emp.get("position", "")
            status   = emp.get("status", "")
            rate     = rate_lookup.get((position, status), 0.0)

            for day_str, hours in days_dict.items():
                if not hours or float(hours) <= 0:
                    continue
                try:
                    d = _date(year, month, int(day_str))
                except Exception:
                    continue
                if date_from <= d <= date_to:
                    name = emp.get("full_name", "").strip()
                    employees_set.add(name)
                    h    = float(hours)
                    cost = h * rate
                    total_hours += h
                    total_cost  += cost
                    dk = d.isoformat()
                    daily_cost[dk] = daily_cost.get(dk, 0.0) + cost
                    if dk not in daily_employees:
                        daily_employees[dk] = set()
                    daily_employees[dk].add(name)

    # Если табель пуст — используем плановые часы из графика (fallback)
    if total_hours == 0:
        use_schedule_fallback = True
        for year, month in sorted(months):
            schedule = get_schedule(production, year, month)
            for emp in schedule.get("employees", []):
                position = emp.get("position", "")
                status   = emp.get("status", "")
                rate     = rate_lookup.get((position, status), 0.0)
                name     = emp.get("full_name", "").strip()
                for day_str, hours in (emp.get("working_days") or {}).items():
                    if not hours or float(hours) <= 0:
                        continue
                    try:
                        d = _date(year, month, int(day_str))
                    except Exception:
                        continue
                    if date_from <= d <= date_to:
                        employees_set.add(name)
                        h    = float(hours)
                        cost = h * rate
                        total_hours += h
                        total_cost  += cost
                        dk = d.isoformat()
                        daily_cost[dk] = daily_cost.get(dk, 0.0) + cost
                        if dk not in daily_employees:
                            daily_employees[dk] = set()
                        daily_employees[dk].add(name)

    # Section-level: по полю section из списка сотрудников; если пусто — определяем по должности из графика
    emp_records = get_employees(production)
    raw_section_map: dict[str, str] = {
        e.get("full_name", "").strip(): (e.get("section") or "").strip()
        for e in emp_records
    }
    # Должность из графика (для подстановки участка, если в списке не проставлен)
    name_to_position: dict[str, str] = {}
    for y, m in sorted(months):
        sched = get_schedule(production, y, m)
        for e in sched.get("employees", []):
            n = (e.get("full_name") or "").strip()
            if n:
                name_to_position[n] = e.get("position", "")

    _infer_fns = {
        "engraving": _infer_section_for_engraving,
        "tea": _infer_section_for_tea,
        "luminarc": _infer_section_for_luminarc,
    }

    def _section_for_name(name: str, position: str = "") -> str:
        sec = raw_section_map.get(name, "").strip()
        if not sec and position:
            infer_fn = _infer_fns.get(production)
            if infer_fn:
                sec = infer_fn(position)
        return sec or ""

    section_hours: dict[str, float] = {}
    section_costs: dict[str, float] = {}
    section_employees: dict[str, set] = {}
    daily_section_cost: dict[str, dict[str, float]] = {}

    def _ensure_section(sec: str) -> None:
        if sec not in section_employees:
            section_employees[sec] = set()
            section_hours[sec] = 0.0
            section_costs[sec] = 0.0
            daily_section_cost[sec] = {}

    _normalize_sec = {
        "engraving": _normalize_engraving_section,
        "tea": _normalize_tea_section,
    }

    def _norm(sec_raw: str) -> str:
        fn = _normalize_sec.get(production)
        return fn(sec_raw) if fn else ((sec_raw or "—").strip() or "—")

    for name in employees_set:
        sec_raw = _section_for_name(name, name_to_position.get(name, ""))
        sec = _norm(sec_raw)
        _ensure_section(sec)
        section_employees[sec].add(name)

    # Учитываем всех, кто встречается в daily_employees
    for dk, names in daily_employees.items():
        for name in names:
            sec_raw = _section_for_name(name, name_to_position.get(name, ""))
            sec = _norm(sec_raw)
            _ensure_section(sec)
            section_employees[sec].add(name)

    # Детализация по каждому сотруднику внутри участка
    emp_details: dict[str, dict[str, dict]] = {}
    # emp_details[sec][name] = {position, status, rate, hours, cost}

    # На уровне часов/ФОТ считаем по полю section, проходя ещё раз по табелю или графику
    for year, month in sorted(months):
        timesheet = get_timesheet(production, year, month)
        schedule = get_schedule(production, year, month)
        emp_by_id = {e["id"]: e for e in schedule.get("employees", [])}

        if use_schedule_fallback:
            items = [
                (e.get("id", ""), e.get("working_days") or {}, e)
                for e in schedule.get("employees", [])
            ]
        else:
            ts_records = timesheet.get("records", {})
            items = [
                (emp_id, days_dict, emp_by_id.get(emp_id))
                for emp_id, days_dict in ts_records.items()
                if emp_by_id.get(emp_id)
            ]

        for emp_id, days_dict, emp in items:
            if not emp:
                continue
            name = emp.get("full_name", "").strip()
            if name not in employees_set:
                continue
            position = emp.get("position", "")
            status = emp.get("status", "")
            rate = rate_lookup.get((position, status), 0.0)
            sec_raw = _section_for_name(name, position)
            sec = _norm(sec_raw)
            _ensure_section(sec)
            section_employees[sec].add(name)

            # Инициализируем запись по сотруднику
            if sec not in emp_details:
                emp_details[sec] = {}
            if name not in emp_details[sec]:
                emp_details[sec][name] = {
                    "position": position,
                    "status":   status,
                    "rate":     round(rate, 2),
                    "hours":    0.0,
                    "cost":     0.0,
                }

            for day_str, hours in days_dict.items():
                if not hours or float(hours) <= 0:
                    continue
                try:
                    d = _date(year, month, int(day_str))
                except Exception:
                    continue
                if not (date_from <= d <= date_to):
                    continue
                h = float(hours)
                cost = h * rate
                dk = d.isoformat()
                section_hours[sec] += h
                section_costs[sec] += cost
                daily_section_cost[sec][dk] = daily_section_cost[sec].get(dk, 0.0) + cost
                emp_details[sec][name]["hours"] += h
                emp_details[sec][name]["cost"]  += cost

    daily_by_section = {
        sec: {k: round(v, 2) for k, v in days.items()}
        for sec, days in daily_section_cost.items()
    }

    sections_summary = {
        sec: {
            "employee_count": len(names),
            "hours": round(section_hours.get(sec, 0.0), 1),
            "cost": round(section_costs.get(sec, 0.0), 2),
            "employees": [
                {
                    "name":     n,
                    "position": info["position"],
                    "status":   info["status"],
                    "rate":     info["rate"],
                    "hours":    round(info["hours"], 1),
                    "cost":     round(info["cost"], 2),
                }
                for n, info in sorted(
                    emp_details.get(sec, {}).items(),
                    key=lambda x: -x[1]["cost"]
                )
            ],
        }
        for sec, names in section_employees.items()
    }

    # Плановые сотрудники из графика (независимо от табеля) — для блока явки
    planned_names: set[str] = set()
    for yr, mo in sorted(months):
        sched = get_schedule(production, yr, mo)
        for emp in sched.get("employees", []):
            name = (emp.get("full_name") or "").strip()
            if not name:
                continue
            for day_str in (emp.get("working_days") or {}):
                try:
                    d = _date(yr, mo, int(day_str))
                except Exception:
                    continue
                if date_from <= d <= date_to:
                    planned_names.add(name)
                    break  # достаточно одного дня

    planned_by_section: dict[str, int] = {}
    for name in planned_names:
        sec_raw = _section_for_name(name, name_to_position.get(name, ""))
        sec = _norm(sec_raw)
        planned_by_section[sec] = planned_by_section.get(sec, 0) + 1

    return {
        "employee_count":   len(employees_set),
        "planned_count":    len(planned_names),
        "actual_count":     len(employees_set),
        "planned_by_section": planned_by_section,
        "actual_by_section":  {s: len(ns) for s, ns in section_employees.items()},
        "total_hours":    round(total_hours, 1),
        "total_cost":     round(total_cost, 2),
        "is_planned":     use_schedule_fallback,
        "daily_cost":     {k: round(v, 2) for k, v in daily_cost.items()},
        "daily_by_section": daily_by_section,
        "by_section":     {s: len(ns) for s, ns in section_employees.items()},
        "sections":       sections_summary,
    }


# ─── Снимки графика (Snapshot) ────────────────────────────────────────────────

def _snapshot_path(production: str, year: int, month: int) -> Path:
    return WORKFORCE_DIR / f"schedule_snapshot_{production}_{year}_{month:02d}.json"


def save_schedule_snapshot(production: str, year: int, month: int) -> dict:
    """Сохранить снимок текущего графика. Возвращает мета-данные снимка."""
    from datetime import datetime as _dt
    schedule = get_schedule(production, year, month)
    saved_at = _dt.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    snapshot = {**schedule, "snapshot_saved_at": saved_at}
    _write_json(_snapshot_path(production, year, month), snapshot)
    return {"saved_at": saved_at, "employee_count": len(schedule.get("employees", []))}


def get_schedule_snapshot(production: str, year: int, month: int) -> Optional[dict]:
    """Вернуть сохранённый снимок или None."""
    path = _snapshot_path(production, year, month)
    if not path.exists():
        return None
    return _read_json(path, None)


def diff_schedule_with_snapshot(production: str, year: int, month: int) -> dict:
    """Сравнить текущий график со снимком."""
    snapshot = get_schedule_snapshot(production, year, month)
    if snapshot is None:
        return {"has_snapshot": False}

    current = get_schedule(production, year, month)
    snap_by_name = {e.get("full_name", "").strip(): e for e in snapshot.get("employees", []) if e.get("full_name")}
    curr_by_name = {e.get("full_name", "").strip(): e for e in current.get("employees", []) if e.get("full_name")}

    added, removed, changed = [], [], []

    for name, emp in curr_by_name.items():
        if name not in snap_by_name:
            added.append({"full_name": name, "position": emp.get("position", ""), "status": emp.get("status", "")})
        else:
            snap_days = snap_by_name[name].get("working_days") or {}
            curr_days = emp.get("working_days") or {}
            if snap_days != curr_days:
                all_days = sorted(set(snap_days) | set(curr_days), key=lambda x: int(x) if x.isdigit() else 0)
                day_changes = [
                    {"day": int(d), "snapshot": snap_days.get(d), "current": curr_days.get(d)}
                    for d in all_days if snap_days.get(d) != curr_days.get(d)
                ]
                if day_changes:
                    changed.append({"full_name": name, "position": emp.get("position", ""), "status": emp.get("status", ""), "changes": day_changes})

    for name in snap_by_name:
        if name not in curr_by_name:
            removed.append({"full_name": name, "position": snap_by_name[name].get("position", ""), "status": snap_by_name[name].get("status", "")})

    return {
        "has_snapshot": True,
        "snapshot_saved_at": snapshot.get("snapshot_saved_at"),
        "production": production,
        "added": added,
        "removed": removed,
        "changed": changed,
        "total_changes": len(added) + len(removed) + len(changed),
    }


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
