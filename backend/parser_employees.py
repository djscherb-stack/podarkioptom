"""Парсер Excel выработки сотрудников. Структура: Операция сканирования, Пользователь, Дата, Выработка кол/дел."""

import os
from typing import Optional
from pathlib import Path
import pandas as pd

from parser import parse_date

# Операция сканирования → подразделение (как в productions)
OPERATION_TO_DEPARTMENT = {
    "гравировочный цех елино": "Гравировочный цех Елино",
    "картон/дерево елино": "Картон/Дерево Елино",
    "картон дерева елино": "Картон/Дерево Елино",
    "купаж": "Купажный цех Елино",
    "упаковка гравировка": "Сборочный цех Елино Гравировка",
    "упаковка-гравировка": "Сборочный цех Елино Гравировка",
    "упаковка елино": "Сборочный цех Елино",
    "упаковка елина": "Сборочный цех Елино",
    "упаковка люминарк": "Сборочный цех Люминарк",
    "фасовка елино": "Фасовочный цех Елино",
    "фасовка елина": "Фасовочный цех Елино",
    "шелкография": "Шелкография Елино Гравировка",
    "шелкография елино": "Шелкография Елино",
    "шелкография елена": "Шелкография Елино",
}


def _map_operation(op: str) -> Optional[str]:
    """Операция сканирования → подразделение."""
    if pd.isna(op) or str(op).strip() == "":
        return None
    key = str(op).strip().lower()
    if key == "итого":
        return None
    return OPERATION_TO_DEPARTMENT.get(key)


def _is_employee_file(df: pd.DataFrame) -> bool:
    """Проверка: это файл выработки сотрудников."""
    cols = [str(c).lower() for c in df.columns]
    return "операция сканирования" in " ".join(cols) and "пользователь" in " ".join(cols) and "выработка" in " ".join(cols)


def load_employee_excel(filepath: Path) -> pd.DataFrame:
    """Загрузка Excel выработки сотрудников."""
    df = pd.read_excel(filepath, header=0)
    if not _is_employee_file(df):
        raise ValueError("Не тот формат: ожидается выработка сотрудников (Операция сканирования, Пользователь, Выработка кол/дел)")

    # Найти колонки по имени
    col_map = {}
    for c in df.columns:
        s = str(c).strip().lower()
        if "операция" in s and "сканирования" in s:
            col_map["operation"] = c
        elif "пользователь" in s:
            col_map["user"] = c
        elif "дата операции" in s:
            col_map["date"] = c
        elif "выработка" in s and ("кол" in s or "дел" in s):
            col_map["quantity"] = c

    if "operation" not in col_map or "user" not in col_map or "quantity" not in col_map:
        raise ValueError("Не найдены колонки: Операция сканирования, Пользователь, Выработка кол/дел")

    df = df.copy()
    df["operation"] = df[col_map["operation"]].fillna("").astype(str).str.strip()
    df["user"] = df[col_map["user"]].fillna("").astype(str).str.strip()
    df["quantity"] = pd.to_numeric(df[col_map["quantity"]], errors="coerce").fillna(0)

    # Дата
    date_col = col_map.get("date")
    if date_col:
        df["date_parsed"] = df[date_col].apply(parse_date)
    else:
        df["date_parsed"] = pd.NaT
    df = df[df["date_parsed"].notna()]

    # Маппинг операции в подразделение
    df["department"] = df["operation"].apply(_map_operation)
    df = df[df["department"].notna()]
    df = df[df["user"] != ""]
    df = df[df["quantity"] > 0]

    return df[["department", "user", "quantity", "date_parsed"]].rename(columns={"date_parsed": "date"})


def load_all_employee_data(data_dir: str) -> pd.DataFrame:
    """Загрузка всех Excel выработки сотрудников."""
    path = Path(data_dir)
    if not path.exists():
        path.mkdir(parents=True, exist_ok=True)

    frames = []
    seen = set()

    def try_add(f: Path):
        if f.name.startswith("~$"):
            return
        key = str(f.resolve())
        if key in seen:
            return
        seen.add(key)
        try:
            df = load_employee_excel(f)
            if not df.empty:
                frames.append(df)
        except (ValueError, Exception) as e:
            pass  # не тот формат — пропускаем

    if path.exists():
        for f in path.glob("**/*.xlsx"):
            try_add(f)
        for f in path.parent.glob("*.xlsx"):
            try_add(f)

    extra = os.environ.get("EXTRA_DATA_DIR")
    if extra:
        for f in Path(extra).rglob("*.xlsx"):
            try_add(f)

    if not frames:
        return pd.DataFrame(columns=["department", "user", "quantity", "date"])

    combined = pd.concat(frames, ignore_index=True)
    combined["date_only"] = combined["date"].apply(lambda x: x.date() if hasattr(x, "date") else x)
    return combined
