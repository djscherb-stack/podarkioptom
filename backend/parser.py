"""Парсер Excel-файлов выпуска продукции."""

import os
from pathlib import Path
from datetime import datetime
from typing import Optional
import pandas as pd


def parse_date(value) -> Optional[datetime]:
    """Парсинг даты из различных форматов (текст, datetime, Excel-серийный номер)."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, pd.Timestamp):
        return value.to_pydatetime()
    # Excel-серийный номер (1 янв 1900 = 1; 1 янв 2026 ≈ 45310)
    if isinstance(value, (int, float)) and value > 0:
        try:
            return (pd.Timestamp("1899-12-30") + pd.Timedelta(days=float(value))).to_pydatetime()
        except (ValueError, OverflowError):
            pass
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
    try:
        ts = pd.to_datetime(value)
        return ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else datetime.fromisoformat(str(ts)[:19])
    except Exception:
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


# Операция сканирования → (производство, участок)
SCAN_OPERATION_MAPPING = {
    "гравировочный цех елино": ("ГРАВИРОВКА", "Гравировочный цех Елино"),
    "картон/дерево елино": ("ГРАВИРОВКА", "Картон/Дерево Елино Гравировка"),
    "картон дерева елино": ("ГРАВИРОВКА", "Картон/Дерево Елино Гравировка"),
    "купаж": ("ЧАЙ", "Купажный цех Елино"),
    "упаковка-гравировка": ("ГРАВИРОВКА", "Сборочный цех Елино Гравировка"),
    "упаковка гравировка": ("ГРАВИРОВКА", "Сборочный цех Елино Гравировка"),
    "упаковка елино": ("ЧАЙ", "Сборочный цех Елино"),
    "фасовка елино": ("ЧАЙ", "Фасовочный цех Елино"),
    "шелкография": ("ГРАВИРОВКА", "Шелкография Елино Гравировка"),
    "шелкография елино": ("ЧАЙ", "Шелкография Елино"),
    "упаковка люминарк": ("ЛЮМИНАРК", "Сборочный цех Люминарк"),
}


def _scan_operation_to_department(op: str) -> Optional[tuple]:
    if not op or not isinstance(op, str):
        return None
    key = op.strip().lower()
    if key == "итого":
        return None
    return SCAN_OPERATION_MAPPING.get(key)


def load_employee_output_file(filepath: Path) -> pd.DataFrame:
    """Загрузка одного Excel выработки сотрудников. Выработка берётся только из колонки «Выработка кол/дел»."""
    df = pd.read_excel(filepath, header=0)
    col_map = {}
    output_col_raw = None  # исходное имя колонки «Выработка кол/дел»
    quantity_col_raw = None
    divider_col_raw = None
    for c in df.columns:
        s = str(c).strip().lower()
        if "операция сканирования" in s:
            col_map[c] = "scan_operation"
        elif "пользователь" in s:
            col_map[c] = "user"
        elif "артикул" in s:
            col_map[c] = "article"
        elif "вид номенклатуры" in s:
            col_map[c] = "nomenclature_type"
        elif "наименование" in s and "номенклатур" in str(c).lower():
            col_map[c] = "product_name"
        elif "дата операции" in s:
            col_map[c] = "date"
        elif "выработка" in s and ("кол" in s or "дел" in s):
            col_map[c] = "output"
            output_col_raw = c
        elif s == "количество":
            col_map[c] = "quantity"
            quantity_col_raw = c
        elif "делитель" in s:
            divider_col_raw = c
            col_map[c] = "divider"
    df = df.rename(columns=col_map)
    # Строго: выработка только из колонки «Выработка кол/дел» (никогда не подставляем Количество)
    if output_col_raw is not None:
        df["output"] = pd.to_numeric(df["output"], errors="coerce").fillna(0)
    elif quantity_col_raw is not None and divider_col_raw is not None:
        # Если колонки «Выработка кол/дел» нет — считаем: Количество / Делитель
        qty = pd.to_numeric(df["quantity"], errors="coerce").fillna(0)
        div = pd.to_numeric(df["divider"], errors="coerce").replace(0, 1)
        df["output"] = (qty / div).fillna(0)
    elif quantity_col_raw is not None:
        df["output"] = pd.to_numeric(df["quantity"], errors="coerce").fillna(0)
    else:
        df["output"] = 0
    scan_col = "scan_operation" if "scan_operation" in df.columns else df.columns[0]
    df["scan_operation"] = df[scan_col].fillna("").astype(str).str.strip()
    df["_prod_dept"] = df["scan_operation"].str.lower().map(
        lambda x: _scan_operation_to_department(x) if isinstance(x, str) else None
    )
    df = df[df["_prod_dept"].notna()]
    if df.empty:
        return pd.DataFrame(columns=["production", "department", "user", "article", "nomenclature_type", "product_name", "date", "output"])
    df["production"] = df["_prod_dept"].map(lambda x: x[0])
    df["department"] = df["_prod_dept"].map(lambda x: x[1])
    df = df.drop(columns=["_prod_dept"])
    user_col = "user" if "user" in df.columns else df.columns[1]
    df["user"] = df[user_col].fillna("").astype(str).str.strip()
    date_col = "date" if "date" in df.columns else None
    if not date_col:
        for c in df.columns:
            if "дат" in str(c).lower():
                date_col = c
                break
    if date_col:
        df["date_parsed"] = df[date_col].apply(parse_date)
        df = df[df["date_parsed"].notna()]
    if df.empty:
        return pd.DataFrame(columns=["production", "department", "user", "article", "nomenclature_type", "product_name", "date", "output"])
    df["date"] = df["date_parsed"]
    for col in ["article", "nomenclature_type", "product_name"]:
        if col not in df.columns:
            df[col] = ""
        else:
            df[col] = df[col].fillna("").astype(str).str.strip()
    return df[["production", "department", "user", "article", "nomenclature_type", "product_name", "date", "output"]]


def load_all_employee_output_data(data_dir: str) -> pd.DataFrame:
    """Загрузка всех Excel выработки сотрудников из data_dir.
    Внутри файла: несколько строк с одним ключом — суммируем.
    Между файлами: один и тот же ключ (дата, участок, сотрудник, номенклатура) — берём max,
    чтобы повторная загрузка или два файла с одним периодом не удваивали выработку."""
    path = Path(data_dir)
    if not path.exists():
        path.mkdir(parents=True, exist_ok=True)
    seen = set()
    aggregated_per_file = []
    for f in path.glob("**/*.xlsx"):
        if f.name.startswith("~$"):
            continue
        if not _is_employee_file(f):
            continue
        key = str(f.resolve())
        if key in seen:
            continue
        seen.add(key)
        try:
            df = load_employee_output_file(f)
            if df.empty:
                continue
            df = df.copy()
            df["_date_only"] = df["date"].apply(lambda x: x.date() if hasattr(x, "date") else x)
            group_cols = ["_date_only", "production", "department", "user", "nomenclature_type", "product_name"]
            if all(c in df.columns for c in group_cols):
                agg = df.groupby(group_cols, as_index=False)["output"].sum()
                aggregated_per_file.append(agg)
        except Exception as e:
            print(f"Ошибка выработки {f}: {e}")
    if not aggregated_per_file:
        return pd.DataFrame(columns=["production", "department", "user", "nomenclature_type", "product_name", "date", "output"])
    combined = pd.concat(aggregated_per_file, ignore_index=True)
    # Между файлами: для одного ключа берём max (не сумму), чтобы не удваивать выработку
    final = combined.groupby(
        ["_date_only", "production", "department", "user", "nomenclature_type", "product_name"],
        as_index=False,
    )["output"].max()
    final["date"] = pd.to_datetime(final["_date_only"])
    return final[["production", "department", "user", "nomenclature_type", "product_name", "date", "output"]]


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
