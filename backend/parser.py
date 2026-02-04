"""Парсер Excel-файлов выпуска продукции."""

import os
from pathlib import Path
from datetime import datetime
from typing import Optional
import pandas as pd


def parse_date(value) -> Optional[datetime]:
    """Парсинг даты из различных форматов."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, pd.Timestamp):
        return value.to_pydatetime()
    s = str(value).strip()
    if not s:
        return None
    s_date = s[:10] if " " in s else s
    for fmt in ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    try:
        return datetime.strptime(s_date, "%d.%m.%Y")
    except ValueError:
        pass
    return None


def load_excel_file(filepath: Path) -> pd.DataFrame:
    """Загрузка одного Excel-файла."""
    df = pd.read_excel(filepath, header=0)
    # Нормализация названий колонок - поддерживаем разные варианты
    columns_map = {
        "Продукция.Номенклатура.Артикул": "article",
        "Продукция.Номенклатура.Вид номенклатуры": "nomenclature_type",
        "Продукция.Номенклатура.Наименование": "product_name",
        "Продукция.Количество": "quantity",
        "Дата": "date",
        "Производство без заказа.Подразделение": "department",
    }
    # Если колонки без префиксов (простой формат)
    simple_map = {
        "Артикул": "article",
        "Вид номенклатуры": "nomenclature_type",
        "Наименование": "product_name",
        "Количество": "quantity",
        "Дата выпуска": "date",
        "Дата": "date",
        "Подразделение": "department",
    }
    
    rename = {}
    for col in df.columns:
        c = str(col).strip()
        if c in columns_map:
            rename[col] = columns_map[c]
        elif c in simple_map:
            rename[col] = simple_map[c]
    
    df = df.rename(columns=rename)
    
    # Выбираем нужные колонки по индексу если переименование не сработало
    if "quantity" not in df.columns and len(df.columns) >= 4:
        df = df.iloc[:, :6]
        df.columns = ["article", "nomenclature_type", "product_name", "quantity", "date", "department"]
    
    # Парсинг даты
    date_col = "date" if "date" in df.columns else df.columns[4]
    df["date_parsed"] = df[date_col].apply(parse_date)
    df = df[df["date_parsed"].notna()]
    
    # Количество - числовое
    qty_col = "quantity" if "quantity" in df.columns else df.columns[3]
    df["quantity"] = pd.to_numeric(df[qty_col], errors="coerce").fillna(0).astype(int)
    
    # Подразделение
    dept_col = "department" if "department" in df.columns else df.columns[5]
    df["department"] = df[dept_col].fillna("Без подразделения").astype(str).str.strip()
    df = df[df["department"] != ""]
    df["department"] = df["department"].replace("", "Без подразделения")
    
    # Вид номенклатуры
    nom_col = "nomenclature_type" if "nomenclature_type" in df.columns else df.columns[1]
    df["nomenclature_type"] = df[nom_col].fillna("").astype(str).str.strip()
    # Если вид пустой - берём наименование
    name_col = "product_name" if "product_name" in df.columns else df.columns[2]
    mask = df["nomenclature_type"] == ""
    df.loc[mask, "nomenclature_type"] = df.loc[mask, name_col]
    
    return df[["article", "nomenclature_type", "product_name", "quantity", "date_parsed", "department"]].rename(
        columns={"date_parsed": "date"}
    )


def _is_employee_file(filepath: Path) -> bool:
    """Быстрая проверка: файл выработки сотрудников (пропускаем для продукции)."""
    try:
        df = pd.read_excel(filepath, header=0, nrows=1)
        cols = " ".join(str(c).lower() for c in df.columns)
        return "операция сканирования" in cols and "пользователь" in cols and "выработка" in cols
    except Exception:
        return False


def load_all_data(data_dir: str) -> pd.DataFrame:
    """Загрузка всех Excel-файлов выпуска продукции (не выработка сотрудников)."""
    import os
    path = Path(data_dir)
    if not path.exists():
        path.mkdir(parents=True, exist_ok=True)
    
    seen = set()
    frames = []
    
    def add_file(f):
        if f.name.startswith("~$"):
            return
        if _is_employee_file(f):
            return  # выработка сотрудников — отдельный парсер
        key = str(f.resolve())
        if key in seen:
            return
        seen.add(key)
        try:
            df = load_excel_file(f)
            frames.append(df)
        except Exception as e:
            print(f"Ошибка загрузки {f}: {e}")
    
    if path.exists():
        for f in path.glob("**/*.xlsx"):
            add_file(f)
        for f in path.parent.glob("*.xlsx"):
            add_file(f)
    
    # Доп. папка из EXTRA_DATA_DIR (Docker)
    extra = os.environ.get("EXTRA_DATA_DIR")
    if extra:
        for f in Path(extra).rglob("*.xlsx"):
            add_file(f)
    
    if not frames:
        return pd.DataFrame(columns=["article", "nomenclature_type", "product_name", "quantity", "date", "department"])
    
    # 1. Внутри каждого файла: несколько строк с одним ключом — СУММИРУЕМ (две по 2400 → 4800)
    # 2. Между файлами: дубли одного периода — берём MAX (повторная загрузка не искажает данные)
    aggregated_per_file = []
    for df in frames:
        df = df.copy()
        df["_date_day"] = df["date"].apply(lambda x: x.date() if hasattr(x, "date") else x)
        group_cols = ["_date_day", "department", "nomenclature_type", "product_name"]
        if all(c in df.columns for c in group_cols):
            agg = df.groupby(group_cols, as_index=False)["quantity"].sum()
            aggregated_per_file.append(agg)

    if not aggregated_per_file:
        return pd.DataFrame(columns=["article", "nomenclature_type", "product_name", "quantity", "date", "department"])

    combined = pd.concat(aggregated_per_file, ignore_index=True)
    # Между файлами: для одного ключа берём max (не сумму), чтобы повторная загрузка периода не удваивала
    group_cols = ["_date_day", "department", "nomenclature_type", "product_name"]
    final = combined.groupby(group_cols, as_index=False)["quantity"].max()
    final["date"] = pd.to_datetime(final["_date_day"])
    final["article"] = ""
    return final[["article", "nomenclature_type", "product_name", "quantity", "date", "department"]]
