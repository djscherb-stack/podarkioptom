"""Кэш данных и бизнес-логика аналитики."""

import os
from pathlib import Path
from datetime import datetime, date, timedelta
from typing import Any, Optional
import pandas as pd

from parser import load_all_data
from parser_employees import load_all_employee_data
from productions import build_productions_stats, build_employee_productions_stats, get_block_config

# Папка с данными. DATA_DIR из env — для persistent disk на Render (загруженные файлы сохраняются)
_default = Path(__file__).resolve().parent.parent / "data"
DATA_DIR = Path(os.environ.get("DATA_DIR", _default))
ROOT_DIR = Path(__file__).resolve().parent.parent

_df: Optional[pd.DataFrame] = None
_df_employees: Optional[pd.DataFrame] = None


def get_data_dir() -> Path:
    """Путь к папке с данными."""
    return DATA_DIR


def ensure_data_dir():
    """Создать папку data если её нет."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def refresh_data():
    """Перезагрузить данные из файлов (продукция + выработка сотрудников)."""
    global _df, _df_employees
    ensure_data_dir()
    _df = load_all_data(str(DATA_DIR))
    _df["year_month"] = _df["date"].dt.to_period("M")
    _df["date_only"] = _df["date"].dt.date
    _df_employees = load_all_employee_data(str(DATA_DIR))


def get_df() -> pd.DataFrame:
    """Получить датафрейм продукции."""
    global _df
    if _df is None:
        refresh_data()
    return _df


def get_employee_df() -> pd.DataFrame:
    """Получить датафрейм выработки сотрудников."""
    global _df_employees
    if _df_employees is None:
        refresh_data()
    return _df_employees if _df_employees is not None else pd.DataFrame(columns=["department", "user", "quantity", "date_only"])


def _prev_month(year: int, month: int) -> tuple[int, int]:
    """Предыдущий месяц."""
    if month == 1:
        return year - 1, 12
    return year, month - 1


def get_monthly_stats(year: int, month: int) -> dict[str, Any]:
    """Аналитика за месяц по производствам + сравнение с предыдущим месяцем."""
    df = get_df()
    if df.empty:
        return {"productions": {}}
    
    period = pd.Period(year=year, month=month, freq="M")
    m = df[df["year_month"] == period]
    if m.empty:
        return {"productions": {}}
    
    productions = build_productions_stats(m)
    
    # Сравнение с предыдущим месяцем
    py, pm = _prev_month(year, month)
    period_prev = pd.Period(year=py, month=pm, freq="M")
    m_prev = df[df["year_month"] == period_prev]
    productions_prev = build_productions_stats(m_prev) if not m_prev.empty else {}
    
    for prod_name, prod_data in productions.items():
        prod_prev = productions_prev.get(prod_name, {})
        depts_prev = {d["name"]: d for d in prod_prev.get("departments", [])}
        for dept in prod_data.get("departments", []):
            prev_dept = depts_prev.get(dept["name"], {})
            y = prev_dept.get("total", 0)
            t = dept.get("total", 0)
            use_float = dept.get("unit") == "кг"
            y = round(float(y), 2) if use_float else int(y)
            t = round(float(t), 2) if use_float else int(t)
            delta = round(t - y, 2) if use_float else t - y
            delta_pct = round((delta / y * 100) if y else 0, 1)
            types_t = len(dept.get("nomenclature", [])) or sum(len(v) for v in (dept.get("nomenclature_by_op") or {}).values())
            types_y = len(prev_dept.get("nomenclature", [])) or sum(len(v) for v in (prev_dept.get("nomenclature_by_op") or {}).values())
            subs_comp = None
            if dept.get("subs"):
                subs_comp = []
                prev_subs = {s["sub_name"]: s.get("total", 0) for s in prev_dept.get("subs", [])}
                for s in dept["subs"]:
                    py_val = prev_subs.get(s["sub_name"], 0)
                    pt = s.get("total", 0)
                    subs_comp.append({"name": s["sub_name"], "today": pt, "yesterday": py_val, "delta": pt - py_val})
            comp = {
                "yesterday": y, "delta": delta, "delta_pct": delta_pct,
                "types_today": types_t, "types_yesterday": types_y, "types_delta": types_t - types_y,
                "subs": subs_comp,
            }
            if dept.get("total_units") is not None:
                u_prev = prev_dept.get("total_units", 0) or 0
                comp["units_today"] = dept["total_units"]
                comp["units_yesterday"] = u_prev
                comp["units_delta"] = dept["total_units"] - u_prev
            dept["comparison"] = comp
    
    return {"productions": productions}


def get_daily_stats(target_date: date) -> dict[str, Any]:
    """Аналитика за день по производствам + сравнение с вчера по каждому участку."""
    df = get_df()
    if df.empty:
        return {
            "date": target_date.isoformat(),
            "productions": {},
        }
    
    yesterday = target_date - timedelta(days=1)
    day_data = df[df["date_only"] == target_date]
    prev_data = df[df["date_only"] == yesterday]
    
    productions_today = build_productions_stats(day_data)
    productions_yesterday = build_productions_stats(prev_data)
    
    # Добавляем расширенное сравнение с вчера по каждому участку
    for prod_name, prod_data in productions_today.items():
        prod_prev = productions_yesterday.get(prod_name, {})
        depts_prev = {d["name"]: d for d in prod_prev.get("departments", [])}
        for dept in prod_data.get("departments", []):
            prev_dept = depts_prev.get(dept["name"], {})
            y = prev_dept.get("total", 0)
            t = dept.get("total", 0)
            use_float = dept.get("unit") == "кг"
            y = round(float(y), 2) if use_float else int(y)
            t = round(float(t), 2) if use_float else int(t)
            delta = round(t - y, 2) if use_float else t - y
            delta_pct = round((delta / y * 100) if y else 0, 1)
            types_t = len(dept.get("nomenclature", [])) or (sum(len(v) for v in (dept.get("nomenclature_by_op") or {}).values()))
            types_y = len(prev_dept.get("nomenclature", [])) or (sum(len(v) for v in (prev_dept.get("nomenclature_by_op") or {}).values()))
            subs_comp = None
            if dept.get("subs"):
                subs_comp = []
                prev_subs = {s["sub_name"]: s.get("total", 0) for s in prev_dept.get("subs", [])}
                for s in dept["subs"]:
                    py = prev_subs.get(s["sub_name"], 0)
                    pt = s.get("total", 0)
                    subs_comp.append({"name": s["sub_name"], "today": pt, "yesterday": py, "delta": pt - py})
            comp = {
                "yesterday": y, "delta": delta, "delta_pct": delta_pct,
                "types_today": types_t, "types_yesterday": types_y, "types_delta": types_t - types_y,
                "subs": subs_comp,
            }
            if dept.get("total_units") is not None:
                u_prev = prev_dept.get("total_units", 0) or 0
                comp["units_today"] = dept["total_units"]
                comp["units_yesterday"] = u_prev
                comp["units_delta"] = dept["total_units"] - u_prev
            dept["comparison"] = comp
    
    return {
        "date": target_date.isoformat(),
        "productions": productions_today,
    }


def _match_dept_for_block(dept: str, raw_keys: list) -> bool:
    """Проверка: подразделение входит в блок (по ключам)."""
    if isinstance(raw_keys, str):
        raw_keys = [raw_keys]
    for key in raw_keys:
        if dept == key or key in str(dept):
            return True
    return False


def get_department_daily_stats(production: str, department: str, year: int, month: int) -> dict[str, Any]:
    """Выпуск по дням для блока подразделения за месяц."""
    df = get_df()
    if df.empty:
        return {"department": department, "production": production, "unit": "шт", "daily": [], "year": year, "month": month}
    
    cfg = get_block_config(production, department)
    if not cfg and production != "Сводка":
        return {"department": department, "production": production, "unit": "шт", "daily": [], "year": year, "month": month}
    
    # Для "Сводка" (старый формат) фильтруем по точному названию подразделения
    if production == "Сводка" or not cfg:
        raw_keys = [department]
        unit = "шт"
        use_kg = False
    else:
        raw_keys = cfg.get("keys", [])
        if isinstance(raw_keys, str):
            raw_keys = [raw_keys]
        unit = cfg.get("unit", "шт")
        use_kg = unit == "кг" and cfg.get("transform") == "grams_to_kg"
    
    period = pd.Period(year=year, month=month, freq="M")
    mask_period = df["year_month"] == period
    mask_dept = df["department"].apply(lambda d: _match_dept_for_block(str(d), raw_keys))
    m = df[mask_period & mask_dept]
    
    if m.empty:
        return {"department": department, "production": production, "unit": unit, "daily": [], "year": year, "month": month}
    
    daily = m.groupby("date_only", as_index=False)["quantity"].sum()
    daily = daily.sort_values("date_only")
    
    result = []
    for _, row in daily.iterrows():
        qty = row["quantity"]
        if use_kg:
            qty = round(qty / 1000, 2)
        else:
            qty = int(qty)
        result.append({"date": str(row["date_only"]), "quantity": qty})
    
    return {"department": department, "production": production, "unit": unit, "daily": result, "year": year, "month": month}


def get_employee_daily_stats(target_date: date) -> dict[str, Any]:
    """Выработка сотрудников за день. Структура как get_daily_stats, детализация — сотрудник, количество."""
    emp_df = get_employee_df()
    if emp_df.empty:
        return {"date": target_date.isoformat(), "productions": {}}
    day_data = emp_df[emp_df["date_only"] == target_date]
    return {
        "date": target_date.isoformat(),
        "productions": build_employee_productions_stats(day_data),
    }


def get_day_compare(target_date: date) -> dict[str, Any]:
    """Сравнение: выпуск продукции vs выработка сотрудников по участкам за день."""
    prod_stats = get_daily_stats(target_date)
    emp_stats = get_employee_daily_stats(target_date)
    prod_prods = prod_stats.get("productions", {})
    emp_prods = emp_stats.get("productions", {})

    compare = []
    for prod_name in ["ЧАЙ", "ГРАВИРОВКА", "ЛЮМИНАРК"]:
        prod_deps = {d["name"]: d for d in prod_prods.get(prod_name, {}).get("departments", [])}
        emp_deps = {d["name"]: d for d in emp_prods.get(prod_name, {}).get("departments", [])}
        all_dept_names = set(prod_deps.keys()) | set(emp_deps.keys())
        for dept_name in sorted(all_dept_names):
            pd_val = prod_deps.get(dept_name, {})
            ed_val = emp_deps.get(dept_name, {})
            prod_total = pd_val.get("total", 0) or 0
            emp_total = ed_val.get("total", 0) or 0
            diff = prod_total - emp_total
            unit = pd_val.get("unit", "шт") or ed_val.get("unit", "шт")
            compare.append({
                "production": prod_name,
                "department": dept_name,
                "product_total": prod_total,
                "employee_total": emp_total,
                "diff": diff,
                "unit": unit,
            })

    return {
        "date": target_date.isoformat(),
        "compare": compare,
    }


def get_available_months() -> list[dict[str, int]]:
    """Список месяцев, для которых есть данные."""
    df = get_df()
    if df.empty:
        return []
    periods = df["year_month"].dropna().unique()
    result = [{"year": int(p.year), "month": int(p.month)} for p in sorted(periods, reverse=True)]
    return result


def get_months_comparison() -> dict[str, Any]:
    """Сравнение выпуска по трём производствам по месяцам (только главные показатели)."""
    months = get_available_months()
    if not months:
        return {"months": [], "productions": {}}

    prod_names = ["ЧАЙ", "ГРАВИРОВКА", "ЛЮМИНАРК"]
    result = {
        "months": [{"year": m["year"], "month": m["month"], "label": f"{_month_name(m['month'])} {m['year']}"} for m in months],
        "productions": {p: [] for p in prod_names},
    }

    main_depts = {
        "ЧАЙ": "Сборочный цех Елино",
        "ГРАВИРОВКА": "Сборочный цех Елино Гравировка",
        "ЛЮМИНАРК": "Сборочный цех Люминарк",
    }

    for m in months:
        stats = get_monthly_stats(m["year"], m["month"])
        prods = stats.get("productions", {})
        for p in prod_names:
            dept_name = main_depts[p]
            val = 0
            unit = "шт"
            for d in prods.get(p, {}).get("departments", []):
                if d.get("name") == dept_name:
                    val = d.get("total_units") if d.get("total_units") is not None else d.get("total", 0)
                    unit = d.get("unit", "шт")
                    break
            result["productions"][p].append({"value": val, "unit": unit})

    return result


def _month_name(month: int) -> str:
    names = ["", "Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"]
    return names[month] if 1 <= month <= 12 else str(month)
