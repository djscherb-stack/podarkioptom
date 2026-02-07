"""Кэш данных и бизнес-логика аналитики."""

import os
from pathlib import Path
from datetime import datetime, date, timedelta
from typing import Any, Optional
import pandas as pd

from parser import load_all_data, load_all_employee_output_data
from productions import build_productions_stats, get_block_config

# Папка с данными. DATA_DIR из env — для persistent disk на Render (загруженные файлы сохраняются)
_default = Path(__file__).resolve().parent.parent / "data"
DATA_DIR = Path(os.environ.get("DATA_DIR", _default))
ROOT_DIR = Path(__file__).resolve().parent.parent

_df: Optional[pd.DataFrame] = None
_df_employee: Optional[pd.DataFrame] = None


def get_data_dir() -> Path:
    """Путь к папке с данными."""
    return DATA_DIR


def ensure_data_dir():
    """Создать папку data если её нет."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def refresh_data():
    """Перезагрузить данные из файлов (продукция + выработка сотрудников)."""
    global _df, _df_employee
    ensure_data_dir()
    _df = load_all_data(str(DATA_DIR))
    _df["year_month"] = _df["date"].dt.to_period("M")
    _df["date_only"] = _df["date"].dt.date
    _df_employee = load_all_employee_output_data(str(DATA_DIR))
    if not _df_employee.empty:
        _df_employee["date_only"] = _df_employee["date"].apply(
            lambda x: x.date() if hasattr(x, "date") else x
        )


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
