"""Кэш данных и бизнес-логика аналитики."""

import os
from pathlib import Path
from datetime import datetime, date, timedelta
from typing import Any, Optional
import pandas as pd

from parser import load_all_data, load_all_employee_output_data
from productions import build_productions_stats, get_block_config

# Разборка возвратов (склад разборки Luminarc)
try:
    from disassembly_parser import load_all_disassembly_data, load_nomenclature_prices, get_disassembly_sources_info
except ImportError:
    load_all_disassembly_data = None
    load_nomenclature_prices = None
    get_disassembly_sources_info = None

# Папка с данными. DATA_DIR из env — для persistent disk на Render (загруженные файлы сохраняются)
_default = Path(__file__).resolve().parent.parent / "data"
DATA_DIR = Path(os.environ.get("DATA_DIR", _default))
ROOT_DIR = Path(__file__).resolve().parent.parent

_df: Optional[pd.DataFrame] = None
_df_employee: Optional[pd.DataFrame] = None
_df_in_warehouse: Optional[pd.DataFrame] = None
_df_ingredients: Optional[pd.DataFrame] = None
_df_out_warehouse: Optional[pd.DataFrame] = None
_df_internal_consumption: Optional[pd.DataFrame] = None
_nomenclature_prices: Optional[dict[str, float]] = None
_nomenclature_prices_lower: Optional[dict[str, float]] = None  # ключ в нижнем регистре для поиска без учёта регистра


def get_data_dir() -> Path:
    """Путь к папке с данными."""
    return DATA_DIR


def ensure_data_dir():
    """Создать папку data если её нет."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _empty_disassembly_dfs():
    """Пустые датафреймы разборки (приложение не падает при ошибке загрузки)."""
    return (
        pd.DataFrame(columns=["date", "document", "nomenclature", "quantity", "date_only"]),
        pd.DataFrame(columns=["date", "document", "nomenclature", "quantity", "date_only"]),
        pd.DataFrame(columns=["date", "document", "nomenclature", "quantity", "date_only"]),
        pd.DataFrame(columns=["date", "document", "nomenclature", "article", "quantity", "date_only"]),
    )


def refresh_data():
    """Перезагрузить данные из файлов (продукция + выработка сотрудников + разборка возвратов). Прайс: при повторной загрузке обновляются/добавляются позиции из файла, отсутствующие в новом файле не удаляются. Не роняет приложение при ошибке."""
    global _df, _df_employee, _df_in_warehouse, _df_ingredients, _df_out_warehouse, _df_internal_consumption, _nomenclature_prices, _nomenclature_prices_lower
    ensure_data_dir()
    try:
        _df = load_all_data(str(DATA_DIR))
        if not _df.empty and "date" in _df.columns:
            _df["year_month"] = _df["date"].dt.to_period("M")
            _df["date_only"] = _df["date"].dt.date
        elif _df.empty:
            _df["year_month"] = pd.Series(dtype=object)
            _df["date_only"] = pd.Series(dtype=object)
    except Exception:
        _df = pd.DataFrame(columns=["article", "nomenclature_type", "product_name", "quantity", "date", "department", "year_month", "date_only"])
    try:
        _df_employee = load_all_employee_output_data(str(DATA_DIR))
        if not _df_employee.empty and "date" in _df_employee.columns:
            _df_employee["date_only"] = _df_employee["date"].apply(
                lambda x: x.date() if hasattr(x, "date") else x
            )
    except Exception:
        _df_employee = pd.DataFrame(columns=["date", "date_only"])
    if load_all_disassembly_data:
        try:
            _df_in_warehouse, _df_ingredients, _df_out_warehouse, _df_internal_consumption = load_all_disassembly_data(str(DATA_DIR))
        except Exception:
            _df_in_warehouse, _df_ingredients, _df_out_warehouse, _df_internal_consumption = _empty_disassembly_dfs()
    else:
        _df_in_warehouse, _df_ingredients, _df_out_warehouse, _df_internal_consumption = _empty_disassembly_dfs()
    if load_nomenclature_prices:
        try:
            new_prices = load_nomenclature_prices(str(DATA_DIR)) or {}
            # Обновляем при повторной загрузке; позиции, которых нет в новом файле, не удаляем
            existing = _nomenclature_prices if _nomenclature_prices is not None else {}
            _nomenclature_prices = {**existing, **new_prices}
            _nomenclature_prices_lower = {str(k).strip().lower(): v for k, v in _nomenclature_prices.items()}
        except Exception:
            if _nomenclature_prices is None:
                _nomenclature_prices = {}
                _nomenclature_prices_lower = {}
    else:
        _nomenclature_prices = {}
        _nomenclature_prices_lower = {}


def get_df() -> pd.DataFrame:
    """Получить датафрейм продукции."""
    global _df
    if _df is None:
        refresh_data()
    return _df


def get_employee_output_df() -> pd.DataFrame:
    """Получить датафрейм выработки сотрудников."""
    global _df_employee
    if _df_employee is None:
        refresh_data()
    return _df_employee


def get_employee_names() -> list[str]:
    """Список ФИО сотрудников (уникальные user из выработки), отсортированный."""
    emp_df = get_employee_output_df()
    if emp_df.empty or "user" not in emp_df.columns:
        return []
    names = emp_df["user"].dropna().astype(str).str.strip()
    names = names[names != ""].unique().tolist()
    return sorted(names)


def get_employee_period_stats(user: str, date_from: date, date_to: date) -> dict[str, Any]:
    """По сотруднику и периоду: даты выхода, кол-во дней, участки, продукция (вид — наименование, кол-во)."""
    emp_df = get_employee_output_df()
    if emp_df.empty:
        return {"work_dates": [], "days_count": 0, "departments": [], "products": []}
    emp_df = emp_df.copy()
    if "date_only" not in emp_df.columns:
        emp_df["date_only"] = emp_df["date"].apply(lambda x: x.date() if hasattr(x, "date") else x)
    user_clean = (user or "").strip()
    mask_user = emp_df["user"].astype(str).str.strip() == user_clean
    mask_from = emp_df["date_only"] >= date_from
    mask_to = emp_df["date_only"] <= date_to
    sub = emp_df.loc[mask_user & mask_from & mask_to]
    if sub.empty:
        return {"work_dates": [], "days_count": 0, "departments": [], "products": []}
    work_dates = sorted(sub["date_only"].unique().tolist())
    work_dates_str = [str(d) for d in work_dates]
    dept_pairs = sub.groupby(["production", "department"]).size().reset_index(name="_n")
    departments = [
        {"production": row["production"], "department": row["department"]}
        for _, row in dept_pairs.iterrows()
    ]
    prod_agg = sub.groupby(["nomenclature_type", "product_name"], as_index=False)["output"].sum()
    products = [
        {
            "nomenclature_type": (row["nomenclature_type"] or "—").strip() or "—",
            "product_name": (row["product_name"] or "—").strip() or "—",
            "output": round(float(row["output"]), 2),
        }
        for _, row in prod_agg.iterrows()
    ]
    products.sort(key=lambda x: (-x["output"], x["nomenclature_type"], x["product_name"]))
    return {
        "work_dates": work_dates_str,
        "days_count": len(work_dates),
        "departments": departments,
        "products": products,
    }


def get_department_list() -> list[dict[str, str]]:
    """Список участков (production, department) из выработки."""
    emp_df = get_employee_output_df()
    if emp_df.empty or "production" not in emp_df.columns:
        return []
    pairs = emp_df.groupby(["production", "department"]).size().reset_index(name="_n")[
        ["production", "department"]
    ]
    return [
        {"production": row["production"], "department": row["department"]}
        for _, row in pairs.sort_values(["production", "department"]).iterrows()
    ]


def get_department_period_stats(
    production: str, department: str, date_from: date, date_to: date
) -> dict[str, Any]:
    """По участку и периоду: сотрудники, продукция, выходы по дням, часы (день=12ч), средний выпуск в час и в смену."""
    emp_df = get_employee_output_df()
    if emp_df.empty:
        return {
            "employees": [],
            "products": [],
            "days_breakdown": [],
            "total_days": 0,
            "total_hours": 0,
            "total_output": 0,
            "avg_per_hour": 0,
            "avg_per_shift": 0,
        }
    emp_df = emp_df.copy()
    if "date_only" not in emp_df.columns:
        emp_df["date_only"] = emp_df["date"].apply(lambda x: x.date() if hasattr(x, "date") else x)
    prod_clean = (production or "").strip()
    dept_clean = (department or "").strip()
    mask_dept = (emp_df["production"].astype(str).str.strip() == prod_clean) & (
        emp_df["department"].astype(str).str.strip() == dept_clean
    )
    mask_from = emp_df["date_only"] >= date_from
    mask_to = emp_df["date_only"] <= date_to
    sub = emp_df.loc[mask_dept & mask_from & mask_to]
    if sub.empty:
        return {
            "employees": [],
            "products": [],
            "days_breakdown": [],
            "total_days": 0,
            "total_hours": 0,
            "total_output": 0,
            "avg_per_hour": 0,
            "avg_per_shift": 0,
        }
    employees = sorted(sub["user"].dropna().astype(str).str.strip().unique().tolist())
    employees = [e for e in employees if e]
    total_output_f = float(sub["output"].sum())
    prod_agg = sub.groupby(["nomenclature_type", "product_name"], as_index=False)["output"].sum()
    products = [
        {
            "nomenclature_type": (row["nomenclature_type"] or "—").strip() or "—",
            "product_name": (row["product_name"] or "—").strip() or "—",
            "output": round(float(row["output"]), 2),
        }
        for _, row in prod_agg.iterrows()
    ]
    products.sort(key=lambda x: (-x["output"], x["nomenclature_type"], x["product_name"]))
    days_count = sub.groupby("date_only")["user"].nunique()
    work_dates = sorted(sub["date_only"].unique().tolist())
    total_days = len(work_dates)
    total_hours = total_days * 12
    days_breakdown = [
        {"date": str(d), "employees_count": int(days_count.get(d, 0))}
        for d in work_dates
    ]
    avg_per_hour = round(total_output_f / total_hours, 2) if total_hours else 0
    avg_per_shift = round(total_output_f / total_days, 2) if total_days else 0
    return {
        "employees": employees,
        "products": products,
        "days_breakdown": days_breakdown,
        "total_days": total_days,
        "total_hours": total_hours,
        "total_output": round(total_output_f, 2),
        "avg_per_hour": avg_per_hour,
        "avg_per_shift": avg_per_shift,
    }


def get_daily_output_stats(target_date: date) -> dict[str, Any]:
    """Выработка сотрудников за день: по участкам, по сотрудникам, детализация по номенклатуре. Сравнение выпуск vs выработка."""
    emp_df = get_employee_output_df()
    if emp_df.empty:
        return {"by_department": [], "comparison": []}
    emp_df = emp_df.copy()
    if "date_only" not in emp_df.columns:
        emp_df["date_only"] = emp_df["date"].apply(lambda x: x.date() if hasattr(x, "date") else x)
    emp_df = emp_df[emp_df["date_only"] == target_date]
    if emp_df.empty:
        return {"by_department": [], "comparison": []}
    by_dept = []
    for (prod, dept), grp in emp_df.groupby(["production", "department"]):
        total_output = grp["output"].sum()
        employees_list = []
        for user, u_grp in grp.groupby("user"):
            u_total = u_grp["output"].sum()
            by_type_list = []
            for nom_type, t_grp in u_grp.groupby("nomenclature_type"):
                t_total = t_grp["output"].sum()
                items_df = t_grp.groupby("product_name", as_index=False)["output"].sum()
                items = [
                    {"product_name": (row["product_name"] or "—").strip() or "—", "output": round(float(row["output"]), 2)}
                    for _, row in items_df.iterrows()
                ]
                if not items:
                    items = [{"product_name": "—", "output": round(float(t_total), 2)}]
                by_type_list.append({
                    "nomenclature_type": (str(nom_type or "—").strip()) or "—",
                    "total": round(float(t_total), 2),
                    "items": items,
                })
            emp_record = {
                "user": user or "—",
                "total": round(float(u_total), 2),
                "by_nomenclature_type": by_type_list,
            }
            # Участок «Картон/Дерево Елино Гравировка»: делим на Оператор станка ЧПУ (есть «вырезанная») и Сборщики
            if dept == "Картон/Дерево Елино Гравировка":
                has_vyrezannaya = False
                for nt in by_type_list:
                    if "вырезанная" in (nt.get("nomenclature_type") or "").lower():
                        has_vyrezannaya = True
                        break
                    for it in nt.get("items") or []:
                        if "вырезанная" in (it.get("product_name") or "").lower():
                            has_vyrezannaya = True
                            break
                emp_record["role"] = "Оператор станка ЧПУ" if has_vyrezannaya else "Сборщик"
            employees_list.append(emp_record)
        n_emp = len(employees_list)
        total_out_f = float(total_output)
        for emp in employees_list:
            emp["share_pct"] = round((emp["total"] / total_out_f) * 100, 1) if total_out_f else 0
        avg_per_emp = round(total_out_f / n_emp, 2) if n_emp else 0
        by_dept.append({
            "production": prod,
            "department": dept,
            "total_output": round(total_out_f, 2),
            "employee_count": n_emp,
            "average_per_employee": avg_per_emp,
            "employees": employees_list,
        })
    day_data = get_df()
    day_data = day_data[day_data["date_only"] == target_date] if not day_data.empty else pd.DataFrame()
    productions_today = build_productions_stats(day_data) if not day_data.empty else {}
    comparison = []
    for item in by_dept:
        prod_name, dept_name = item["production"], item["department"]
        output_val = item["total_output"]
        release_val = 0
        unit = "шт"
        for d in productions_today.get(prod_name, {}).get("departments", []):
            if d.get("name") == dept_name:
                release_val = d.get("total_units") if d.get("total_units") is not None else d.get("total")
                unit = d.get("unit", "шт")
                break
        # ЧАЙ Сборочный цех Елино: в сравнении показываем выпуск из 1С (не нашу выработку по номенклатуре)
        if prod_name == "ЧАЙ" and dept_name == "Сборочный цех Елино":
            output_val = release_val
        # ЧАЙ Купажный цех Елино: выработка в Excel в граммах — приводим к кг для сравнения с 1С
        elif prod_name == "ЧАЙ" and dept_name == "Купажный цех Елино":
            output_val = round(float(output_val) / 1000, 2)
        comparison.append({
            "production": prod_name,
            "department": dept_name,
            "release": int(release_val) if isinstance(release_val, (int, float)) and release_val == int(release_val) else round(float(release_val), 2),
            "output": output_val,
            "unit": unit,
        })
    return {"by_department": by_dept, "comparison": comparison}


def _prev_month(year: int, month: int) -> tuple[int, int]:
    """Предыдущий месяц."""
    if month == 1:
        return year - 1, 12
    return year, month - 1


def _get_week_range(year: int, week: int) -> tuple[date, date]:
    """Диапазон дат (понедельник-воскресенье) для ISO-недели."""
    start = date.fromisocalendar(year, week, 1)
    end = start + timedelta(days=6)
    return start, end


def get_available_weeks() -> list[dict[str, Any]]:
    """Список недель, для которых есть данные (ISO-год/номер + диапазон дат)."""
    df = get_df()
    if df.empty:
        return []
    dates = df["date_only"].dropna().unique().tolist()
    weeks_set: set[tuple[int, int]] = set()
    weeks: list[dict[str, Any]] = []
    for d in dates:
        iso = d.isocalendar()
        key = (iso.year, iso.week)
        if key in weeks_set:
            continue
        weeks_set.add(key)
        start, end = _get_week_range(iso.year, iso.week)
        label = f"Неделя {iso.week:02d} {iso.year} ({start.strftime('%d.%m')}–{end.strftime('%d.%m')})"
        weeks.append(
            {
                "year": int(iso.year),
                "week": int(iso.week),
                "start": str(start),
                "end": str(end),
                "label": label,
            }
        )
    weeks.sort(key=lambda w: (w["year"], w["week"]), reverse=True)
    return weeks


def get_weekly_stats(year: int, week: int) -> dict[str, Any]:
    """Аналитика за неделю по производствам + сравнение с предыдущей неделей."""
    df = get_df()
    start, end = _get_week_range(year, week)
    if df.empty:
        return {"week_start": str(start), "week_end": str(end), "productions": {}}

    mask = (df["date_only"] >= start) & (df["date_only"] <= end)
    w = df[mask]
    if w.empty:
        return {"week_start": str(start), "week_end": str(end), "productions": {}}

    productions = build_productions_stats(w)

    # Сравнение с предыдущей неделей
    prev_start = start - timedelta(days=7)
    prev_end = end - timedelta(days=7)
    mask_prev = (df["date_only"] >= prev_start) & (df["date_only"] <= prev_end)
    w_prev = df[mask_prev]
    productions_prev = build_productions_stats(w_prev) if not w_prev.empty else {}

    for prod_name, prod_data in productions.items():
        prod_prev = productions_prev.get(prod_name, {})
        depts_prev = {d["name"]: d for d in prod_prev.get("departments", [])}
        for dept in prod_data.get("departments", []):
            prev_dept = depts_prev.get(dept["name"], {})
            y = prev_dept.get("total", 0)
            t = dept.get("total", 0)
            use_float = dept.get("unit") == "кг"
            y_val = round(float(y), 2) if use_float else int(y)
            t_val = round(float(t), 2) if use_float else int(t)
            delta = round(t_val - y_val, 2) if use_float else t_val - y_val
            delta_pct = round((delta / y_val * 100) if y_val else 0, 1)
            types_t = len(dept.get("nomenclature", [])) or sum(
                len(v) for v in (dept.get("nomenclature_by_op") or {}).values()
            )
            types_y = len(prev_dept.get("nomenclature", [])) or sum(
                len(v) for v in (prev_dept.get("nomenclature_by_op") or {}).values()
            )
            subs_comp = None
            if dept.get("subs"):
                subs_comp = []
                prev_subs = {s["sub_name"]: s.get("total", 0) for s in prev_dept.get("subs", [])}
                for s in dept["subs"]:
                    py_val = prev_subs.get(s["sub_name"], 0)
                    pt = s.get("total", 0)
                    subs_comp.append(
                        {"name": s["sub_name"], "today": pt, "yesterday": py_val, "delta": pt - py_val}
                    )
            comp = {
                "yesterday": y_val,
                "delta": delta,
                "delta_pct": delta_pct,
                "types_today": types_t,
                "types_yesterday": types_y,
                "types_delta": types_t - types_y,
                "subs": subs_comp,
            }
            if dept.get("total_units") is not None:
                u_prev = prev_dept.get("total_units", 0) or 0
                comp["units_today"] = dept["total_units"]
                comp["units_yesterday"] = u_prev
                comp["units_delta"] = dept["total_units"] - u_prev
            dept["comparison"] = comp

    return {"week_start": str(start), "week_end": str(end), "productions": productions}


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


def _get_block_daily_trend(prod_name: str, block_name: str, end_date: date, days: int = 30) -> tuple[list[dict], float]:
    """Тренд по дням за последние days дней и среднее за период (без end_date)."""
    df = get_df()
    if df.empty:
        return [], 0.0
    cfg = get_block_config(prod_name, block_name)
    if not cfg:
        return [], 0.0
    raw_keys = cfg.get("keys", [])
    if isinstance(raw_keys, str):
        raw_keys = [raw_keys]
    use_kg = cfg.get("unit") == "кг" and cfg.get("transform") == "grams_to_kg"
    start = end_date - timedelta(days=days)
    mask = (df["date_only"] >= start) & (df["date_only"] < end_date)
    mask_dept = df["department"].apply(lambda d: _match_dept_for_block(str(d), raw_keys))
    m = df[mask & mask_dept]
    if m.empty:
        return [], 0.0
    use_sbor_units = (prod_name == "ЧАЙ" and block_name == "Сборочный цех Елино")
    if use_sbor_units:
        from productions import _calc_sbor_units
        daily_groups = m.groupby("date_only")
        rows_list = []
        for date_val, g in daily_groups:
            units, _ = _calc_sbor_units(g)
            rows_list.append({"date_only": date_val, "quantity": units})
        daily = pd.DataFrame(rows_list).sort_values("date_only")
    else:
        daily = m.groupby("date_only", as_index=False)["quantity"].sum()
        daily = daily.sort_values("date_only")
    trend = []
    total = 0.0
    for _, row in daily.iterrows():
        qty = row["quantity"]
        if use_kg:
            qty = round(qty / 1000, 2)
        else:
            qty = int(qty)
        trend.append({"date": str(row["date_only"]), "quantity": qty})
        total += qty
    avg = round(total / len(trend), 2) if trend else 0.0
    return trend, avg


def get_daily_stats(target_date: date) -> dict[str, Any]:
    """Аналитика за день + сравнение с вчера + среднее за 30 дней + тренд."""
    df = get_df()
    if df.empty:
        return {
            "date": target_date.isoformat(),
            "productions": {},
            "employee_output": get_daily_output_stats(target_date),
        }
    
    yesterday = target_date - timedelta(days=1)
    day_data = df[df["date_only"] == target_date]
    prev_data = df[df["date_only"] == yesterday]
    
    productions_today = build_productions_stats(day_data)
    productions_yesterday = build_productions_stats(prev_data)

    # Предрасчёт для last_7_days: один вызов build_productions_stats на день вместо 7×N на отделов
    prod_by_day: dict[date, dict] = {}
    for i in range(6, -1, -1):
        d = target_date - timedelta(days=i)
        day_df = df[df["date_only"] == d]
        prod_by_day[d] = build_productions_stats(day_df) if not day_df.empty else {}
    
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
            
            # Среднее за 30 дней и тренд
            trend_30d, avg_30d = _get_block_daily_trend(prod_name, dept["name"], target_date, 30)
            dept["trend_30d"] = trend_30d
            dept["avg_30d"] = avg_30d
            t_val = t if use_float else float(t)
            vs_avg = round(t_val - avg_30d, 2)
            vs_avg_pct = round((vs_avg / avg_30d * 100) if avg_30d else 0, 1)
            dept["vs_avg_delta"] = vs_avg
            dept["vs_avg_pct"] = vs_avg_pct

            # Последние 7 дней: из предрасчитанного prod_by_day (не вызываем build_productions_stats повторно)
            last_7_days = []
            for i in range(6, -1, -1):
                d = target_date - timedelta(days=i)
                prod_day = prod_by_day.get(d, {})
                dept_day = None
                for _pn, pdata in prod_day.items():
                    for dep in pdata.get("departments", []):
                        if dep["name"] == dept["name"]:
                            dept_day = dep
                            break
                    if dept_day:
                        break
                if not dept_day:
                    last_7_days.append({"date": d.isoformat(), "total": 0, "total_units": None, "nomenclature": []})
                else:
                    nom = list(dept_day.get("nomenclature", []))
                    if not nom and dept_day.get("nomenclature_by_op"):
                        for op_items in dept_day["nomenclature_by_op"].values():
                            nom.extend(op_items)
                    tot = dept_day.get("total", 0)
                    tot = round(float(tot), 2) if use_float else int(tot)
                    tu = dept_day.get("total_units")
                    last_7_days.append({"date": d.isoformat(), "total": tot, "total_units": tu, "nomenclature": nom})
            dept["last_7_days"] = last_7_days

    employee_output = get_daily_output_stats(target_date)
    yesterday = target_date - timedelta(days=1)
    out_yesterday = get_daily_output_stats(yesterday)
    prev_by_key = {(item["production"], item["department"]): item for item in out_yesterday.get("by_department", [])}
    for item in employee_output.get("by_department", []):
        key = (item["production"], item["department"])
        prev = prev_by_key.get(key)
        item["employee_count_yesterday"] = prev["employee_count"] if prev else None
        item["average_per_employee_yesterday"] = prev["average_per_employee"] if prev else None

    return {
        "date": target_date.isoformat(),
        "productions": productions_today,
        "employee_output": employee_output,
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
    
    # Сборочный цех Елино (ЧАЙ): график в «ед. продукции», как на странице «По дню»
    use_sbor_units = (production == "ЧАЙ" and department == "Сборочный цех Елино")
    
    if use_sbor_units:
        from productions import _calc_sbor_units
        daily_groups = m.groupby("date_only")
        rows_list = []
        for date_val, g in daily_groups:
            units, _ = _calc_sbor_units(g)
            rows_list.append({"date_only": date_val, "quantity": units})
        daily = pd.DataFrame(rows_list).sort_values("date_only")
        unit = "ед."
    else:
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


def get_last_n_days_detailed_for_ai(target_date: date, days: int = 10) -> list[dict[str, Any]]:
    """
    Детальные данные за последние N дней для ИИ: по каждому дню, по каждому производству и участку,
    полная номенклатура (вид, наименование, количество). Для глубокого анализа трендов и «лёгких/сложных» видов.
    """
    df = get_df()
    if df.empty:
        return []
    result = []
    for i in range(days - 1, -1, -1):
        d = target_date - timedelta(days=i)
        day_df = df[df["date_only"] == d]
        if day_df.empty:
            result.append({"date": d.isoformat(), "productions": {}})
            continue
        productions = build_productions_stats(day_df)
        # Оставляем только нужное для промпта: по участкам — итог и полная номенклатура
        day_out = {"date": d.isoformat(), "productions": {}}
        for prod_name, prod_data in productions.items():
            day_out["productions"][prod_name] = {"departments": []}
            for dept in prod_data.get("departments", []):
                block = {
                    "name": dept.get("name"),
                    "unit": dept.get("unit", "шт"),
                    "total": dept.get("total", 0),
                    "total_units": dept.get("total_units"),
                    "main": dept.get("main", False),
                    "nomenclature": list(dept.get("nomenclature", [])),
                    "nomenclature_by_op": dict(dept.get("nomenclature_by_op") or {}),
                    "subs": list(dept.get("subs") or []),
                }
                day_out["productions"][prod_name]["departments"].append(block)
        result.append(day_out)
    return result


def get_data_date_range() -> dict:
    """Диагностика: диапазон дат и количество записей по дням (для отладки пропавших данных)."""
    df = get_df()
    if df.empty:
        return {"dates": [], "min_date": None, "max_date": None}
    daily_counts = df.groupby("date_only", as_index=False).size()
    daily_counts = daily_counts.sort_values("date_only")
    dates = [{"date": str(row["date_only"]), "rows": int(row["size"])} for _, row in daily_counts.iterrows()]
    return {
        "dates": dates,
        "min_date": str(df["date_only"].min()) if not df.empty else None,
        "max_date": str(df["date_only"].max()) if not df.empty else None,
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


# --- Разборка возвратов (склад разборки Luminarc) ---


def get_disassembly_dfs() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Возвращает (поступление наборов на склад, поступление ингредиентов после разборки, отгрузка, внутреннее потребление)."""
    global _df_in_warehouse, _df_ingredients, _df_out_warehouse, _df_internal_consumption
    if _df_in_warehouse is None:
        refresh_data()
    return _df_in_warehouse, _df_ingredients, _df_out_warehouse, _df_internal_consumption


def get_disassembly_stats(
    group_by: str = "day",
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> dict[str, Any]:
    """
    Агрегированная аналитика разборки возвратов.
    group_by: "day" | "week" | "month"
    Возвращает строки с датой/неделей/месяцем, поступление (qty), отгрузка (qty), списание (qty), проценты.
    """
    in_df, ingredients_df, out_df, internal_df = get_disassembly_dfs()
    global _nomenclature_prices
    if _nomenclature_prices is None:
        refresh_data()
    prices = _nomenclature_prices or {}
    prices_lower = _nomenclature_prices_lower or {}

    def _get_price(nom: str) -> float:
        n = (nom or "").strip()
        if n in prices:
            return prices[n]
        return prices_lower.get(n.lower(), 0.0)

    rows: list[dict[str, Any]] = []
    if in_df.empty and ingredients_df.empty and out_df.empty and internal_df.empty:
        return {"group_by": group_by, "rows": [], "totals": {"in_qty": 0, "ingredients_qty": 0, "out_qty": 0, "internal_qty": 0, "in_cost": 0, "ingredients_cost": 0, "internal_cost": 0, "out_cost": 0, "balance_start": 0, "balance_end": 0, "balance_start_cost": 0, "balance_end_cost": 0}}

    all_dates: set[date] = set()
    if "date_only" in in_df.columns:
        all_dates.update(in_df["date_only"].dropna().tolist())
    if "date_only" in ingredients_df.columns:
        all_dates.update(ingredients_df["date_only"].dropna().tolist())
    if "date_only" in out_df.columns:
        all_dates.update(out_df["date_only"].dropna().tolist())
    if "date_only" in internal_df.columns:
        all_dates.update(internal_df["date_only"].dropna().tolist())

    if not all_dates:
        return {"group_by": group_by, "rows": [], "totals": {"in_qty": 0, "ingredients_qty": 0, "out_qty": 0, "internal_qty": 0, "in_cost": 0, "ingredients_cost": 0, "internal_cost": 0, "out_cost": 0, "balance_start": 0, "balance_end": 0, "balance_start_cost": 0, "balance_end_cost": 0}}

    # Даты в хронологическом порядке для расчёта переноса остатков
    sorted_dates = sorted(d for d in all_dates if (not date_from or d >= date_from) and (not date_to or d <= date_to))

    def _cost_for_date(df: pd.DataFrame, d: date) -> float:
        if df.empty or "date_only" not in df.columns or "nomenclature" not in df.columns or "quantity" not in df.columns:
            return 0.0
        sub = df[df["date_only"] == d]
        total = 0.0
        for _, row in sub.iterrows():
            nom = (row.get("nomenclature") or "")
            if isinstance(nom, str):
                nom = nom.strip()
            else:
                nom = str(nom).strip()
            qty = float(row.get("quantity") or 0)
            total += qty * _get_price(nom)
        return total

    def _qty_by_nom_for_date(df: pd.DataFrame, d: date) -> dict[str, float]:
        if df.empty or "date_only" not in df.columns or "nomenclature" not in df.columns:
            return {}
        sub = df[df["date_only"] == d]
        out: dict[str, float] = {}
        for _, row in sub.iterrows():
            nom = (row.get("nomenclature") or "")
            nom = nom.strip() if isinstance(nom, str) else str(nom).strip()
            qty = float(row.get("quantity") or 0)
            out[nom] = out.get(nom, 0) + qty
        return out

    def _balance_cost(balance_by_nom: dict[str, float]) -> float:
        """Стоимость остатка = сумма (остаток × цена) по всем позициям. При недостаче (отрицательный остаток) стоимость тоже отрицательная."""
        return sum(qty * _get_price(nom) for nom, qty in balance_by_nom.items())

    # Остаток на складе: только поступило после разборки (ingredients) минус списано (internal) минус отгружено (out).
    # «Поступило на склад» (in) — информационная строка (что поступило на разбор), в остаток не входит.
    # Стоимость остатка = оценка по текущим ценам (остаток × цена по каждой номенклатуре), чтобы при плюсе в штуках не было минуса в рублях.
    balance_by_nom: dict[str, float] = {}
    daily_rows: list[dict[str, Any]] = []
    for d in sorted_dates:
        in_qty = 0
        if not in_df.empty and "date_only" in in_df.columns:
            in_qty = float(in_df.loc[in_df["date_only"] == d, "quantity"].sum())
        ingredients_qty = 0
        if not ingredients_df.empty and "date_only" in ingredients_df.columns:
            ingredients_qty = float(ingredients_df.loc[ingredients_df["date_only"] == d, "quantity"].sum())
        out_qty = 0
        if not out_df.empty and "date_only" in out_df.columns:
            out_qty = float(out_df.loc[out_df["date_only"] == d, "quantity"].sum())
        internal_qty = 0
        if not internal_df.empty and "date_only" in internal_df.columns:
            internal_qty = float(internal_df.loc[internal_df["date_only"] == d, "quantity"].sum())
        in_cost = _cost_for_date(in_df, d)
        ingredients_cost = _cost_for_date(ingredients_df, d)
        internal_cost = _cost_for_date(internal_df, d)
        out_cost = _cost_for_date(out_df, d)
        balance_start = sum(balance_by_nom.values())
        balance_start_cost = _balance_cost(balance_by_nom)
        for nom, qty in _qty_by_nom_for_date(ingredients_df, d).items():
            balance_by_nom[nom] = balance_by_nom.get(nom, 0) + qty
        for nom, qty in _qty_by_nom_for_date(internal_df, d).items():
            balance_by_nom[nom] = balance_by_nom.get(nom, 0) - qty
        for nom, qty in _qty_by_nom_for_date(out_df, d).items():
            balance_by_nom[nom] = balance_by_nom.get(nom, 0) - qty
        balance_by_nom = {k: v for k, v in balance_by_nom.items() if v != 0}
        balance_end = sum(balance_by_nom.values())
        balance_end_cost = _balance_cost(balance_by_nom)
        row = {
            "date": str(d),
            "in_qty": round(in_qty, 2),
            "ingredients_qty": round(ingredients_qty, 2),
            "out_qty": round(out_qty, 2),
            "internal_qty": round(internal_qty, 2),
            "in_cost": round(in_cost, 2),
            "ingredients_cost": round(ingredients_cost, 2),
            "internal_cost": round(internal_cost, 2),
            "out_cost": round(out_cost, 2),
            "balance_start": round(balance_start, 2),
            "balance_end": round(balance_end, 2),
            "balance_start_cost": round(balance_start_cost, 2),
            "balance_end_cost": round(balance_end_cost, 2),
        }
        # Корректировка на 18 февраля: остаток на начало 4 999 штук, остаток на конец — из данных
        _CORRECTION_DATE = date(2026, 2, 18)
        _CORRECTION_BALANCE_START = 4999
        if d == _CORRECTION_DATE:
            corr_end = _CORRECTION_BALANCE_START + ingredients_qty - internal_qty - out_qty
            row["balance_start"] = _CORRECTION_BALANCE_START
            row["balance_end"] = round(corr_end, 2)
            if balance_start != 0:
                row["balance_start_cost"] = round((_CORRECTION_BALANCE_START / balance_start) * balance_start_cost, 2)
            if balance_end != 0:
                row["balance_end_cost"] = round((corr_end / balance_end) * balance_end_cost, 2)
            row["is_correction"] = True
            row["correction_note"] = f"Корректировка: остаток на начало — 4 999 штук, остаток на конец — {int(round(corr_end, 0))} штук"
        daily_rows.append(row)

    if group_by == "day":
        rows = daily_rows
        rows.sort(key=lambda r: r["date"], reverse=True)
    elif group_by == "week":
        # Группировка по ISO-неделе; остаток на начало недели = конец предыдущей, на конец = по последнему дню недели
        week_agg: dict[tuple[int, int], dict] = {}
        for r in daily_rows:
            d = datetime.strptime(r["date"], "%Y-%m-%d").date()
            iso = d.isocalendar()
            key = (iso.year, iso.week)
            if key not in week_agg:
                start = date.fromisocalendar(iso.year, iso.week, 1)
                end = start + timedelta(days=6)
                week_agg[key] = {
                    "year": iso.year,
                    "week": iso.week,
                    "label": f"Неделя {iso.week:02d} ({start.strftime('%d.%m')}–{end.strftime('%d.%m')})",
                    "in_qty": 0,
                    "ingredients_qty": 0,
                    "out_qty": 0,
                    "internal_qty": 0,
                    "in_cost": 0,
                    "ingredients_cost": 0,
                    "internal_cost": 0,
                    "out_cost": 0,
                    "balance_start": r["balance_start"],
                    "balance_end": r["balance_end"],
                    "balance_start_cost": r.get("balance_start_cost", 0),
                    "balance_end_cost": r.get("balance_end_cost", 0),
                }
            week_agg[key]["in_qty"] += r["in_qty"]
            week_agg[key]["ingredients_qty"] += r["ingredients_qty"]
            week_agg[key]["out_qty"] += r["out_qty"]
            week_agg[key]["internal_qty"] += r["internal_qty"]
            week_agg[key]["in_cost"] += r.get("in_cost", 0)
            week_agg[key]["ingredients_cost"] += r.get("ingredients_cost", 0)
            week_agg[key]["internal_cost"] += r.get("internal_cost", 0)
            week_agg[key]["out_cost"] += r.get("out_cost", 0)
            week_agg[key]["balance_end"] = r["balance_end"]
            week_agg[key]["balance_end_cost"] = r.get("balance_end_cost", 0)
        rows = [{"date": f"{v['year']}-W{v['week']:02d}", **v} for v in sorted(week_agg.values(), key=lambda x: (x["year"], x["week"]), reverse=True)]
    elif group_by == "month":
        month_agg: dict[tuple[int, int], dict] = {}
        for r in daily_rows:
            d = datetime.strptime(r["date"], "%Y-%m-%d").date()
            key = (d.year, d.month)
            if key not in month_agg:
                month_agg[key] = {
                    "year": d.year,
                    "month": d.month,
                    "label": f"{_month_name(d.month)} {d.year}",
                    "in_qty": 0,
                    "ingredients_qty": 0,
                    "out_qty": 0,
                    "internal_qty": 0,
                    "in_cost": 0,
                    "ingredients_cost": 0,
                    "internal_cost": 0,
                    "out_cost": 0,
                    "balance_start": r["balance_start"],
                    "balance_end": r["balance_end"],
                    "balance_start_cost": r.get("balance_start_cost", 0),
                    "balance_end_cost": r.get("balance_end_cost", 0),
                }
            month_agg[key]["in_qty"] += r["in_qty"]
            month_agg[key]["ingredients_qty"] += r["ingredients_qty"]
            month_agg[key]["out_qty"] += r["out_qty"]
            month_agg[key]["internal_qty"] += r["internal_qty"]
            month_agg[key]["in_cost"] += r.get("in_cost", 0)
            month_agg[key]["ingredients_cost"] += r.get("ingredients_cost", 0)
            month_agg[key]["internal_cost"] += r.get("internal_cost", 0)
            month_agg[key]["out_cost"] += r.get("out_cost", 0)
            month_agg[key]["balance_end"] = r["balance_end"]
            month_agg[key]["balance_end_cost"] = r.get("balance_end_cost", 0)
        rows = [{"date": f"{v['year']}-{v['month']:02d}", **v} for v in sorted(month_agg.values(), key=lambda x: (x["year"], x["month"]), reverse=True)]

    total_in = sum(r["in_qty"] for r in rows)
    total_ingredients = sum(r["ingredients_qty"] for r in rows)
    total_out = sum(r["out_qty"] for r in rows)
    total_internal = sum(r["internal_qty"] for r in rows)
    total_in_cost = sum(r.get("in_cost", 0) for r in rows)
    total_ingredients_cost = sum(r.get("ingredients_cost", 0) for r in rows)
    total_internal_cost = sum(r.get("internal_cost", 0) for r in rows)
    total_out_cost = sum(r.get("out_cost", 0) for r in rows)
    # 100% = поступило после разборки (ингредиенты). Проценты списано и отгружено — от этой базы.
    for r in rows:
        ing_q = r["ingredients_qty"]
        if ing_q and ing_q > 0:
            r["internal_pct"] = round((r["internal_qty"] / ing_q * 100), 1)
            r["out_pct"] = round((r["out_qty"] / ing_q * 100), 1)
        else:
            r["internal_pct"] = None
            r["out_pct"] = None
        # Проверка по остатку на конец (с учётом переноса)
        balance_end = r.get("balance_end", 0)
        r["check_balance"] = round(balance_end, 2)
        if balance_end < 0:
            r["check_status"] = "не хватает"
            r["check_message"] = f"Не хватает {abs(round(balance_end, 0))}"
        elif balance_end > 0:
            r["check_status"] = "остаток"
            r["check_message"] = f"Остаток {round(balance_end, 0)}"
        else:
            r["check_status"] = "ok"
            r["check_message"] = "Сходится"

    total_internal_pct = round((total_internal / total_ingredients * 100), 1) if total_ingredients and total_ingredients > 0 else None
    total_out_pct = round((total_out / total_ingredients * 100), 1) if total_ingredients and total_ingredients > 0 else None
    # Итоговый остаток = остаток на конец последнего периода (первая строка при сортировке по убыванию даты)
    total_balance_end = rows[0]["balance_end"] if rows else 0
    if total_balance_end < 0:
        total_check_status, total_check_message = "не хватает", f"Не хватает {abs(round(total_balance_end, 0))}"
    elif total_balance_end > 0:
        total_check_status, total_check_message = "остаток", f"Остаток {round(total_balance_end, 0)}"
    else:
        total_check_status, total_check_message = "ok", "Сходится"

    return {
        "group_by": group_by,
        "rows": rows,
        "totals": {
            "in_qty": round(total_in, 2),
            "ingredients_qty": round(total_ingredients, 2),
            "out_qty": round(total_out, 2),
            "internal_qty": round(total_internal, 2),
            "in_cost": round(total_in_cost, 2),
            "ingredients_cost": round(total_ingredients_cost, 2),
            "internal_cost": round(total_internal_cost, 2),
            "out_cost": round(total_out_cost, 2),
            "balance_start": round(rows[-1]["balance_start"], 2) if rows else 0,
            "balance_end": round(total_balance_end, 2),
            "balance_start_cost": round(rows[-1].get("balance_start_cost", 0), 2) if rows else 0,
            "balance_end_cost": round(rows[0].get("balance_end_cost", 0), 2) if rows else 0,
            "internal_pct": total_internal_pct,
            "out_pct": total_out_pct,
            "check_balance": round(total_balance_end, 2),
            "check_status": total_check_status,
            "check_message": total_check_message,
        },
    }


def get_disassembly_summary(
    period: str = "month",
    top_in: int = 5,
    top_internal: int = 15,
    top_out: int = 15,
) -> dict[str, Any]:
    """
    Сводка для инфографики: топ по номенклатуре за период (неделя / месяц / всё время).
    period: "week" | "month" | "all"
    """
    in_df, ingredients_df, out_df, internal_df = get_disassembly_dfs()
    today = date.today()
    if period == "week":
        date_from = today - timedelta(days=7)
    elif period == "month":
        date_from = today - timedelta(days=31)
    else:
        date_from = None
    date_to = today

    def _filter_df(df: pd.DataFrame):
        if df.empty or "date_only" not in df.columns:
            return df
        mask = df["date_only"] <= date_to
        if date_from:
            mask = mask & (df["date_only"] >= date_from)
        return df[mask]

    def _top_n(df: pd.DataFrame, n: int) -> list[dict]:
        if df.empty or "nomenclature" not in df.columns:
            return []
        agg = df.groupby("nomenclature", as_index=False)["quantity"].sum()
        agg = agg.sort_values("quantity", ascending=False).head(n)
        return [
            {"name": row["nomenclature"], "quantity": int(round(float(row["quantity"])))}
            for _, row in agg.iterrows()
        ]

    in_f = _filter_df(in_df)
    out_f = _filter_df(out_df)
    internal_f = _filter_df(internal_df)

    return {
        "period": period,
        "date_from": str(date_from) if date_from else None,
        "date_to": str(date_to),
        "top_received": _top_n(in_f, top_in),
        "top_internal": _top_n(internal_f, top_internal),
        "top_out": _top_n(out_f, top_out),
    }


def get_disassembly_detail_by_date(
    target_date: str,
    detail_type: str,
    flow: str,
) -> dict[str, Any]:
    """
    Детализация за дату.
    flow: "in" | "out" | "internal"
    detail_type: "nomenclature" | "documents"
    Для internal дополнительно detail_type: "articles"
    Каждый item: name, quantity, cost (сумма в рублях по прайсу).
    """
    global _nomenclature_prices, _nomenclature_prices_lower
    if _nomenclature_prices is None:
        refresh_data()
    prices = _nomenclature_prices or {}
    prices_lower = _nomenclature_prices_lower or {}

    def _get_price(nom: str) -> float:
        n = (nom or "").strip()
        if n in prices:
            return prices[n]
        return prices_lower.get(n.lower(), 0.0)

    in_df, ingredients_df, out_df, internal_df = get_disassembly_dfs()
    try:
        d = datetime.strptime(target_date, "%Y-%m-%d").date()
    except ValueError:
        return {"error": "Неверный формат даты YYYY-MM-DD", "items": []}

    if flow == "in":
        df = in_df
    elif flow == "ingredients":
        df = ingredients_df
    elif flow == "out":
        df = out_df
    else:
        df = internal_df

    if df.empty or "date_only" not in df.columns:
        return {"date": target_date, "flow": flow, "detail_type": detail_type, "items": []}

    sub = df[df["date_only"] == d].copy()
    if sub.empty:
        return {"date": target_date, "flow": flow, "detail_type": detail_type, "items": []}

    def _row_cost(row: pd.Series) -> float:
        nom = (row.get("nomenclature") or "")
        if isinstance(nom, str):
            nom = nom.strip()
        else:
            nom = str(nom).strip()
        qty = float(row.get("quantity") or 0)
        return qty * _get_price(nom)

    if detail_type == "nomenclature":
        agg = sub.groupby("nomenclature", as_index=False)["quantity"].sum()
        items = []
        for _, row in agg.iterrows():
            nom = row["nomenclature"]
            qty = round(float(row["quantity"]), 2)
            cost = qty * _get_price((nom or "").strip() if isinstance(nom, str) else str(nom).strip())
            items.append({"name": nom, "quantity": qty, "cost": round(cost, 2)})
        items.sort(key=lambda x: (-x["quantity"], x["name"]))
    elif detail_type == "documents":
        sub["_cost"] = sub.apply(_row_cost, axis=1)
        agg = sub.groupby("document", as_index=False).agg({"quantity": "sum", "_cost": "sum"})
        items = [
            {"name": row["document"], "quantity": round(float(row["quantity"]), 2), "cost": round(float(row["_cost"]), 2)}
            for _, row in agg.iterrows()
        ]
        items.sort(key=lambda x: (-x["quantity"], x["name"]))
    elif detail_type == "articles" and flow == "internal" and "article" in sub.columns:
        sub["_cost"] = sub.apply(_row_cost, axis=1)
        agg = sub.groupby("article", as_index=False).agg({"quantity": "sum", "_cost": "sum"})
        items = [
            {"name": row["article"], "quantity": round(float(row["quantity"]), 2), "cost": round(float(row["_cost"]), 2)}
            for _, row in agg.iterrows()
        ]
        items.sort(key=lambda x: (-x["quantity"], x["name"]))
    else:
        items = []

    return {"date": target_date, "flow": flow, "detail_type": detail_type, "items": items}


def get_disassembly_full_detail_by_date(target_date: str) -> dict[str, Any]:
    """
    Полная детализация за день: остаток на начало, поступило на склад, после разборки, списано, отгружено —
    всё в разрезе номенклатуры (наименование, количество, сумма в рублях).
    """
    global _nomenclature_prices, _nomenclature_prices_lower
    if _nomenclature_prices is None:
        refresh_data()
    prices = _nomenclature_prices or {}
    prices_lower = _nomenclature_prices_lower or {}

    def _get_price(nom: str) -> float:
        n = (nom or "").strip()
        if n in prices:
            return prices[n]
        return prices_lower.get(n.lower(), 0.0)

    in_df, ingredients_df, out_df, internal_df = get_disassembly_dfs()
    try:
        d_target = datetime.strptime(target_date, "%Y-%m-%d").date()
    except ValueError:
        return {"error": "Неверный формат даты YYYY-MM-DD", "date": target_date}

    all_dates: set[date] = set()
    for df in (in_df, ingredients_df, out_df, internal_df):
        if not df.empty and "date_only" in df.columns:
            all_dates.update(df["date_only"].dropna().tolist())
    sorted_dates = sorted(all_dates)

    def _qty_by_nom_for_date(df: pd.DataFrame, d: date) -> dict[str, float]:
        if df.empty or "date_only" not in df.columns or "nomenclature" not in df.columns:
            return {}
        sub = df[df["date_only"] == d]
        out: dict[str, float] = {}
        for _, row in sub.iterrows():
            nom = (row.get("nomenclature") or "")
            nom = nom.strip() if isinstance(nom, str) else str(nom).strip()
            qty = float(row.get("quantity") or 0)
            out[nom] = out.get(nom, 0) + qty
        return out

    # Остаток: только ingredients − internal − out; «поступило на склад» (in) не входит в остаток
    balance_by_nom: dict[str, float] = {}
    for d in sorted_dates:
        if d >= d_target:
            break
        for nom, qty in _qty_by_nom_for_date(ingredients_df, d).items():
            balance_by_nom[nom] = balance_by_nom.get(nom, 0) + qty
        for nom, qty in _qty_by_nom_for_date(internal_df, d).items():
            balance_by_nom[nom] = balance_by_nom.get(nom, 0) - qty
        for nom, qty in _qty_by_nom_for_date(out_df, d).items():
            balance_by_nom[nom] = balance_by_nom.get(nom, 0) - qty
        balance_by_nom = {k: v for k, v in balance_by_nom.items() if v != 0}

    in_qty = _qty_by_nom_for_date(in_df, d_target)
    ingredients_qty = _qty_by_nom_for_date(ingredients_df, d_target)
    internal_qty = _qty_by_nom_for_date(internal_df, d_target)
    out_qty = _qty_by_nom_for_date(out_df, d_target)
    all_noms = set(balance_by_nom) | set(in_qty) | set(ingredients_qty) | set(internal_qty) | set(out_qty)

    rows: list[dict[str, Any]] = []
    for nom in sorted(all_noms):
        bal_start = balance_by_nom.get(nom, 0.0)
        in_q = in_qty.get(nom, 0.0)
        ing_q = ingredients_qty.get(nom, 0.0)
        int_q = internal_qty.get(nom, 0.0)
        out_q = out_qty.get(nom, 0.0)
        bal_end = bal_start + ing_q - int_q - out_q
        price = _get_price(nom)
        # Стоимость остатка только по положительному остатку (что лежит на складе)
        rows.append({
            "name": nom,
            "balance_start": round(bal_start, 2),
            "balance_start_cost": round(bal_start * price, 2),
            "in_qty": round(in_q, 2),
            "in_cost": round(in_q * price, 2),
            "ingredients_qty": round(ing_q, 2),
            "ingredients_cost": round(ing_q * price, 2),
            "internal_qty": round(int_q, 2),
            "internal_cost": round(int_q * price, 2),
            "out_qty": round(out_q, 2),
            "out_cost": round(out_q * price, 2),
            "balance_end": round(bal_end, 2),
            "balance_end_cost": round(bal_end * price, 2),
        })
    return {"date": target_date, "rows": rows}


def get_disassembly_nomenclature_list() -> list[str]:
    """Все уникальные наименования номенклатуры из данных разборки (как в таблицах — для копирования в 1С)."""
    in_df, ingredients_df, out_df, internal_df = get_disassembly_dfs()
    seen: set[str] = set()
    for df in (in_df, ingredients_df, out_df, internal_df):
        if df.empty or "nomenclature" not in df.columns:
            continue
        for v in df["nomenclature"].dropna().astype(str).str.strip():
            if v:
                seen.add(v)
    return sorted(seen)


def get_disassembly_missing_prices() -> list[str]:
    """Номенклатура из данных разборки, по которой не загружена себестоимость (нет в прайсе)."""
    try:
        global _nomenclature_prices, _nomenclature_prices_lower
        if _nomenclature_prices is None:
            refresh_data()
        prices_lower = (_nomenclature_prices_lower or {}).copy()
        all_names = set(get_disassembly_nomenclature_list())
        missing = [n for n in all_names if (n or "").strip().lower() not in prices_lower]
        return sorted(missing)
    except Exception:
        return []


def get_data_sources_status() -> dict[str, Any]:
    """Статус источников данных для админки: 001–004, цены, выработка, выпуск — файл, строки, даты."""
    refresh_data()
    result: dict[str, Any] = {}
    if load_all_disassembly_data and get_disassembly_sources_info:
        try:
            result["disassembly"] = get_disassembly_sources_info(str(DATA_DIR))
        except Exception as e:
            result["disassembly"] = {"error": str(e)}
    else:
        result["disassembly"] = {"001": {}, "002": {}, "003": {}, "004": {}}
    price_path = DATA_DIR / "цена поступления номенклатуры.xlsx"
    prices = (load_nomenclature_prices(str(DATA_DIR)) if load_nomenclature_prices else {}) or {}
    result["prices"] = {
        "file": "цена поступления номенклатуры.xlsx",
        "exists": price_path.exists(),
        "count": len(prices),
        "label": "Себестоимость (прайс)",
    }
    df = get_df()
    result["production"] = {
        "rows": len(df),
        "dates": int(df["date_only"].nunique()) if not df.empty and "date_only" in df.columns else 0,
        "label": "Выпуск продукции",
    }
    emp = get_employee_output_df()
    result["employee_output"] = {
        "rows": len(emp),
        "dates": int(emp["date_only"].nunique()) if not emp.empty and "date_only" in emp.columns else 0,
        "label": "Выработка сотрудников",
    }
    return result
