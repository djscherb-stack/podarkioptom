"""Парсер Excel-файлов разборки возвратов (склад разборки Luminarc).

Три типа файлов:
1. Перемещение на склад Разборки — поступление на склад возвратов (документ, номенклатура, кол-во в ед. хранения).
2. Перемещение готовой продукции со склада разборки — отгрузка со склада разборки (документ, номенклатура, кол-во).
3. Внутреннее потребление Разборка — списание (документ, номенклатура, статья списания, кол-во).
"""

import re
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd


def parse_date_from_doc(value) -> Optional[datetime]:
    """Извлекает дату из строки документа вида «... от 03.01.2026 19:00:00» или «... от 25.01.2026»."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    s = str(value).strip()
    if not s:
        return None
    m = re.search(r"от\s+(\d{1,2})\.(\d{1,2})\.(\d{4})", s, re.I)
    if m:
        try:
            d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            return datetime(y, mo, d)
        except (ValueError, TypeError):
            pass
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except (ValueError, TypeError):
            pass
    return None


def _normalize_document(doc: str) -> str:
    """Убирает время из строки документа, чтобы один и тот же документ из разных файлов совпадал при дедупликации."""
    if not doc or not isinstance(doc, str):
        return (doc or "").strip()
    s = doc.strip()
    # «ПОПО-000527 от 03.01.2026 19:00:00» -> «ПОПО-000527 от 03.01.2026»
    s = re.sub(r"\s+\d{1,2}:\d{2}(:\d{2})?\s*$", "", s)
    return s.strip()


def _is_movement_to_warehouse_file(filepath: Path) -> bool:
    """Файл «Перемещение на склад Разборки»."""
    try:
        df = pd.read_excel(filepath, header=0, nrows=1)
        cols = " ".join(str(c).lower() for c in df.columns)
        return "перемещение товаров" in cols and "номенклатура" in cols and "количество" in cols and "единицах хранения" in cols
    except Exception:
        return False


def _is_movement_from_warehouse_file(filepath: Path) -> bool:
    """Файл «Перемещение готовой продукции со склада разборки»."""
    try:
        df = pd.read_excel(filepath, header=0, nrows=1)
        cols = " ".join(str(c).lower() for c in df.columns)
        # тот же набор: документ перемещения, номенклатура, количество в ед. хранения
        return "перемещение" in cols and "номенклатура" in cols and ("количество" in cols or "единицах хранения" in cols)
    except Exception:
        return False


def _is_internal_consumption_file(filepath: Path) -> bool:
    """Файл «Внутреннее потребление Разборка»."""
    try:
        df = pd.read_excel(filepath, header=0, nrows=1)
        cols = " ".join(str(c).lower() for c in df.columns)
        return "внутреннее потребление" in cols and "статья списания" in cols and "номенклатура" in cols
    except Exception:
        return False


def _is_ingredients_after_disassembly_file(filepath: Path) -> bool:
    """Файл «004 Поступление ингредиентов после разборки» (движение продукции и материалов)."""
    try:
        df = pd.read_excel(filepath, header=0, nrows=1)
        cols = " ".join(str(c).lower() for c in df.columns)
        return "движение продукции" in cols and "номенклатура" in cols and "количество" in cols
    except Exception:
        return False


def _find_column(df: pd.DataFrame, *candidates: str) -> Optional[str]:
    """Возвращает имя колонки, если она есть (по точному или частичному совпадению)."""
    col_lower = {str(c).strip().lower(): c for c in df.columns}
    for cand in candidates:
        c_low = cand.strip().lower()
        if c_low in col_lower:
            return col_lower[c_low]
        for k in col_lower:
            if c_low in k or (len(c_low) > 3 and k.startswith(c_low[:4])):
                return col_lower[k]
    return None


def load_movement_to_warehouse(filepath: Path) -> pd.DataFrame:
    """
    Перемещение на склад Разборки.
    Колонки: документ (дата из него), номенклатура, количество в единицах хранения.
    """
    df = pd.read_excel(filepath, header=0)
    doc_col = _find_column(df, "Перемещение товаров", "перемещение товаров") or (df.columns[0] if len(df.columns) > 0 else None)
    nom_col = _find_column(df, "Номенклатура", "номенклатура") or (df.columns[1] if len(df.columns) > 1 else None)
    qty_col = _find_column(df, "Количество(в единицах хранения)", "количество(в единицах хранения)", "Количество") or (df.columns[11] if len(df.columns) > 11 else df.columns[-1])
    if doc_col is None or nom_col is None or qty_col is None:
        return pd.DataFrame(columns=["date", "document", "nomenclature", "quantity"])
    df = df.copy()
    df["date"] = df[doc_col].apply(parse_date_from_doc)
    df = df[df["date"].notna()]
    df["document"] = df[doc_col].astype(str).str.strip()
    df["nomenclature"] = df[nom_col].fillna("").astype(str).str.strip()
    df["quantity"] = pd.to_numeric(df[qty_col], errors="coerce").fillna(0)
    df = df[df["quantity"] > 0]
    return df[["date", "document", "nomenclature", "quantity"]]


def load_movement_from_warehouse(filepath: Path) -> pd.DataFrame:
    """
    Перемещение готовой продукции со склада разборки.
    Колонки: документ, номенклатура, количество в единицах хранения.
    """
    df = pd.read_excel(filepath, header=0)
    doc_col = _find_column(df, "Перемещение", "перемещение товаров", "Перемещение товаров") or (df.columns[0] if len(df.columns) > 0 else None)
    nom_col = _find_column(df, "Номенклатура", "номенклатура") or (df.columns[1] if len(df.columns) > 1 else None)
    qty_col = _find_column(df, "Количество(в единицах хранения)", "количество(в единицах хранения)", "Количество") or (df.columns[11] if len(df.columns) > 11 else df.columns[-1])
    if doc_col is None or nom_col is None or qty_col is None:
        return pd.DataFrame(columns=["date", "document", "nomenclature", "quantity"])
    df = df.copy()
    df["date"] = df[doc_col].apply(parse_date_from_doc)
    df = df[df["date"].notna()]
    df["document"] = df[doc_col].astype(str).str.strip()
    df["nomenclature"] = df[nom_col].fillna("").astype(str).str.strip()
    df["quantity"] = pd.to_numeric(df[qty_col], errors="coerce").fillna(0)
    df = df[df["quantity"] > 0]
    return df[["date", "document", "nomenclature", "quantity"]]


def load_internal_consumption(filepath: Path) -> pd.DataFrame:
    """
    Внутреннее потребление Разборка.
    Колонки: документ, номенклатура, статья списания, количество.
    Важно: в 1С есть «Количество упаковок» и «Количество» — нужна именно «Количество» (штуки).
    """
    df = pd.read_excel(filepath, header=0)
    doc_col = _find_column(df, "Внутреннее потребление", "внутреннее потребление") or (df.columns[0] if len(df.columns) > 0 else None)
    nom_col = _find_column(df, "Номенклатура", "номенклатура") or (df.columns[1] if len(df.columns) > 1 else None)
    article_col = _find_column(df, "Статья списания", "статья списания") or (df.columns[3] if len(df.columns) > 3 else None)
    # Точно колонка «Количество» (не «Количество упаковок»): 18-я колонка в выгрузке 1С или точное совпадение
    qty_col = None
    for c in df.columns:
        if str(c).strip() == "Количество":
            qty_col = c
            break
    if qty_col is None and len(df.columns) > 17:
        qty_col = df.columns[17]
    if qty_col is None:
        qty_col = df.columns[-1] if len(df.columns) else None
    if doc_col is None or nom_col is None or qty_col is None:
        return pd.DataFrame(columns=["date", "document", "nomenclature", "article", "quantity"])
    df = df.copy()
    df["date"] = df[doc_col].apply(parse_date_from_doc)
    df = df[df["date"].notna()]
    df["document"] = df[doc_col].astype(str).str.strip()
    df["nomenclature"] = df[nom_col].fillna("").astype(str).str.strip()
    df["article"] = df[article_col].fillna("").astype(str).str.strip() if article_col else ""
    df["quantity"] = pd.to_numeric(df[qty_col], errors="coerce").fillna(0)
    df = df[df["quantity"] > 0]
    out_cols = ["date", "document", "nomenclature", "quantity"]
    if "article" in df.columns:
        out_cols.insert(3, "article")
    return df[[c for c in out_cols if c in df.columns]]


def load_ingredients_after_disassembly(filepath: Path) -> pd.DataFrame:
    """
    Поступление ингредиентов после разборки (004).
    Колонки: документ (дата из него), номенклатура, количество.
    """
    df = pd.read_excel(filepath, header=0)
    doc_col = _find_column(df, "Движение продукции и материалов", "движение продукции") or (df.columns[0] if len(df.columns) > 0 else None)
    nom_col = _find_column(df, "Номенклатура", "номенклатура") or (df.columns[1] if len(df.columns) > 1 else None)
    qty_col = _find_column(df, "Количество (в единицах хранения)", "количество(в единицах хранения)", "Количество") or (df.columns[2] if len(df.columns) > 2 else df.columns[-1])
    if doc_col is None or nom_col is None or qty_col is None:
        return pd.DataFrame(columns=["date", "document", "nomenclature", "quantity"])
    df = df.copy()
    df["date"] = df[doc_col].apply(parse_date_from_doc)
    df = df[df["date"].notna()]
    df["document"] = df[doc_col].astype(str).str.strip()
    df["nomenclature"] = df[nom_col].fillna("").astype(str).str.strip()
    df["quantity"] = pd.to_numeric(df[qty_col], errors="coerce").fillna(0)
    df = df[df["quantity"] > 0]
    return df[["date", "document", "nomenclature", "quantity"]]


# Префиксы имён файлов (как в Google Drive) — при совпадении тип файла определяем по имени, а не по колонкам.
# В 1С оба отчёта (поступление и отгрузка) могут иметь колонку "Перемещение товаров", поэтому без префикса
# файл отгрузки ошибочно распознавался бы как поступление.
_FNAME_PREFIX_INTERNAL = "001"
_FNAME_PREFIX_OUT = "002"
_FNAME_PREFIX_IN = "003"


def _disassembly_file_type_by_name(filepath: Path) -> Optional[str]:
    """По префиксу имени файла возвращает 'in' | 'out' | 'internal' или None (определять по содержимому)."""
    name = filepath.name
    if not name or not name.strip():
        return None
    # Файлы с Google Drive сохраняются как 001_gdrive_..., 002_gdrive_..., 003_gdrive_...
    # Локальные/загруженные вручную могут быть «003 Поступление возвратов...» и т.д.
    if name.startswith("003_") or name.startswith("003 Поступление возвратов") or name.startswith("003 ") or name.lower().startswith("003"):
        return "in"
    if name.startswith("002_") or name.startswith("002 Перемещение готовой продукции") or name.startswith("002 ") or name.lower().startswith("002"):
        return "out"
    if name.startswith("001_") or name.startswith("001 Внутреннее потребление") or name.startswith("001 ") or name.lower().startswith("001"):
        return "internal"
    if name.startswith("004_") or name.startswith("004 Поступление ингредиентов") or name.startswith("004 ") or name.lower().startswith("004"):
        return "ingredients"
    return None


def load_all_disassembly_data(data_dir: str) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Загружает все четыре типа файлов разборки из data_dir.
    По аналогии с выпуском продукции и выработкой сотрудников: по каждому типу (001–004)
    читаются все подходящие файлы, данные объединяются; для одного ключа (дата, документ, номенклатура)
    берётся max(quantity), чтобы повторная выгрузка не удваивала данные.
    Возвращает (in_to_warehouse, ingredients_after_disassembly, out_from_warehouse, internal_consumption).
    """
    path = Path(data_dir)
    if not path.exists():
        path.mkdir(parents=True, exist_ok=True)

    # По каждому типу собираем все подходящие файлы (path)
    in_candidates: list[Path] = []
    ingredients_candidates: list[Path] = []
    out_candidates: list[Path] = []
    internal_candidates: list[Path] = []

    for f in path.glob("**/*.xlsx"):
        if f.name.startswith("~$"):
            continue
        try:
            name_type = _disassembly_file_type_by_name(f)
            if name_type == "in":
                in_candidates.append(f)
                continue
            if name_type == "ingredients":
                ingredients_candidates.append(f)
                continue
            if name_type == "out":
                out_candidates.append(f)
                continue
            if name_type == "internal":
                internal_candidates.append(f)
                continue
            # Определение по содержимому для файлов без префикса
            if _is_movement_to_warehouse_file(f):
                in_candidates.append(f)
            elif _is_ingredients_after_disassembly_file(f):
                ingredients_candidates.append(f)
            elif _is_internal_consumption_file(f):
                internal_candidates.append(f)
            elif _is_movement_from_warehouse_file(f):
                out_candidates.append(f)
        except Exception as e:
            print(f"Ошибка разборки {f}: {e}")

    def _load_all_and_merge(candidates: list, loader, columns: list) -> pd.DataFrame:
        """Загружает все файлы типа; внутри файла — sum(quantity), между файлами — max (как выпуск/выработка)."""
        if not candidates:
            return pd.DataFrame(columns=columns)
        aggregated_per_file = []
        for fp in candidates:
            try:
                df = loader(fp)
                if df.empty or "date" not in df.columns:
                    continue
                df = df.copy()
                df["date_only"] = df["date"].apply(lambda x: x.date() if hasattr(x, "date") else x)
                df["_norm_doc"] = df["document"].astype(str).apply(_normalize_document)
                group_cols = ["date_only", "_norm_doc", "nomenclature"]
                if "article" in df.columns:
                    group_cols.append("article")
                agg_df = df.groupby(group_cols, as_index=False).agg({"quantity": "sum", "document": "first"})
                aggregated_per_file.append(agg_df)
            except Exception as e:
                print(f"Ошибка загрузки {fp}: {e}")
        if not aggregated_per_file:
            return pd.DataFrame(columns=columns)
        combined = pd.concat(aggregated_per_file, ignore_index=True)
        group_cols = ["date_only", "_norm_doc", "nomenclature"]
        if "article" in combined.columns:
            group_cols.append("article")
        merged = combined.groupby(group_cols, as_index=False).agg({"quantity": "max", "document": "first"})
        merged["date"] = pd.to_datetime(merged["date_only"])
        merged = merged.drop(columns=["_norm_doc"], errors="ignore")
        return merged

    in_df = _load_all_and_merge(in_candidates, load_movement_to_warehouse, ["date", "document", "nomenclature", "quantity"])
    ingredients_df = _load_all_and_merge(ingredients_candidates, load_ingredients_after_disassembly, ["date", "document", "nomenclature", "quantity"])
    out_df = _load_all_and_merge(out_candidates, load_movement_from_warehouse, ["date", "document", "nomenclature", "quantity"])
    internal_df = _load_all_and_merge(internal_candidates, load_internal_consumption, ["date", "document", "nomenclature", "article", "quantity"])

    # Группировка по (дата, документ, номенклатура): суммируем quantity, т.к. в одном документе может быть несколько строк с одной номенклатурой.
    # Раньше стояло "max" — это занижало итоги (учитывалась только одна строка вместо суммы).
    if not in_df.empty and "date" in in_df.columns:
        in_df["date_only"] = in_df["date"].apply(lambda x: x.date() if hasattr(x, "date") else x)
        in_df["_norm_doc"] = in_df["document"].astype(str).apply(_normalize_document)
        in_df = in_df.groupby(["date_only", "_norm_doc", "nomenclature"], as_index=False).agg({"quantity": "sum", "document": "first"})
        in_df["date"] = pd.to_datetime(in_df["date_only"])
        in_df = in_df.drop(columns=["_norm_doc"], errors="ignore")
    if not out_df.empty and "date" in out_df.columns:
        out_df["date_only"] = out_df["date"].apply(lambda x: x.date() if hasattr(x, "date") else x)
        out_df["_norm_doc"] = out_df["document"].astype(str).apply(_normalize_document)
        out_df = out_df.groupby(["date_only", "_norm_doc", "nomenclature"], as_index=False).agg({"quantity": "sum", "document": "first"})
        out_df["date"] = pd.to_datetime(out_df["date_only"])
        out_df = out_df.drop(columns=["_norm_doc"], errors="ignore")
    if not internal_df.empty and "date" in internal_df.columns:
        internal_df["date_only"] = internal_df["date"].apply(lambda x: x.date() if hasattr(x, "date") else x)
        internal_df["_norm_doc"] = internal_df["document"].astype(str).apply(_normalize_document)
        group_cols = ["date_only", "_norm_doc", "nomenclature"] + (["article"] if "article" in internal_df.columns else [])
        internal_df = internal_df.groupby(group_cols, as_index=False).agg({"quantity": "sum", "document": "first"})
        internal_df["date"] = pd.to_datetime(internal_df["date_only"])
        internal_df = internal_df.drop(columns=["_norm_doc"], errors="ignore")
    if not ingredients_df.empty and "date" in ingredients_df.columns:
        ingredients_df["date_only"] = ingredients_df["date"].apply(lambda x: x.date() if hasattr(x, "date") else x)
        ingredients_df["_norm_doc"] = ingredients_df["document"].astype(str).apply(_normalize_document)
        ingredients_df = ingredients_df.groupby(["date_only", "_norm_doc", "nomenclature"], as_index=False).agg({"quantity": "sum", "document": "first"})
        ingredients_df["date"] = pd.to_datetime(ingredients_df["date_only"])
        ingredients_df = ingredients_df.drop(columns=["_norm_doc"], errors="ignore")

    return in_df, ingredients_df, out_df, internal_df


def get_disassembly_sources_info(data_dir: str) -> dict:
    """
    Возвращает по каждому типу 001–004: какой файл выбран, сколько строк и дат.
    Для диагностики в админке (почему нет отгруженных и т.д.).
    """
    path = Path(data_dir)
    if not path.exists():
        return {"001": {"file": None, "rows": 0, "dates": 0, "error": "Папка не найдена"},
                "002": {"file": None, "rows": 0, "dates": 0, "error": "Папка не найдена"},
                "003": {"file": None, "rows": 0, "dates": 0, "error": "Папка не найдена"},
                "004": {"file": None, "rows": 0, "dates": 0, "error": "Папка не найдена"}}

    in_candidates: list[Path] = []
    ingredients_candidates: list[Path] = []
    out_candidates: list[Path] = []
    internal_candidates: list[Path] = []

    for f in path.glob("**/*.xlsx"):
        if f.name.startswith("~$"):
            continue
        try:
            name_type = _disassembly_file_type_by_name(f)
            if name_type == "in":
                in_candidates.append(f)
                continue
            if name_type == "ingredients":
                ingredients_candidates.append(f)
                continue
            if name_type == "out":
                out_candidates.append(f)
                continue
            if name_type == "internal":
                internal_candidates.append(f)
                continue
            if _is_movement_to_warehouse_file(f):
                in_candidates.append(f)
            elif _is_ingredients_after_disassembly_file(f):
                ingredients_candidates.append(f)
            elif _is_internal_consumption_file(f):
                internal_candidates.append(f)
            elif _is_movement_from_warehouse_file(f):
                out_candidates.append(f)
        except Exception:
            pass

    def _load_all_info(candidates: list, loader) -> tuple:
        """По аналогии с загрузкой: все файлы типа объединяются, возвращаем (описание, строк, дат)."""
        if not candidates:
            return "—", 0, 0
        n_files = len(candidates)
        try:
            frames = []
            for fp in candidates:
                df = loader(fp)
                if df.empty or "date" not in df.columns:
                    continue
                df = df.copy()
                df["date_only"] = df["date"].apply(lambda x: x.date() if hasattr(x, "date") else x)
                frames.append(df)
            if not frames:
                return f"{n_files} файл(ов)", 0, 0
            combined = pd.concat(frames, ignore_index=True)
            rows = len(combined)
            dates = int(combined["date_only"].nunique()) if "date_only" in combined.columns else 0
            return f"{n_files} файл(ов)", rows, dates
        except Exception:
            return f"{n_files} файл(ов)", 0, 0

    f001, r001, d001 = _load_all_info(internal_candidates, load_internal_consumption)
    f002, r002, d002 = _load_all_info(out_candidates, load_movement_from_warehouse)
    f003, r003, d003 = _load_all_info(in_candidates, load_movement_to_warehouse)
    f004, r004, d004 = _load_all_info(ingredients_candidates, load_ingredients_after_disassembly)

    return {
        "001": {"file": f001, "rows": r001, "dates": d001, "label": "Внутреннее потребление (списание)"},
        "002": {"file": f002, "rows": r002, "dates": d002, "label": "Отгрузка готовой продукции"},
        "003": {"file": f003, "rows": r003, "dates": d003, "label": "Поступление на склад"},
        "004": {"file": f004, "rows": r004, "dates": d004, "label": "Поступление ингредиентов после разборки"},
    }


def load_nomenclature_prices(data_dir: str) -> dict[str, float]:
    """
    Загружает прайс «цена поступления номенклатуры» из data_dir.
    Ищет файл «цена поступления номенклатуры.xlsx»: колонка 0 — наименование, последняя — цена.
    Возвращает словарь { наименование (strip): цена }.
    """
    path = Path(data_dir) / "цена поступления номенклатуры.xlsx"
    if not path.exists():
        return {}
    try:
        df = pd.read_excel(path, header=None)
        if df.empty or len(df) < 3:
            return {}
        # Данные с 3-й строки (индекс 2); колонка 0 — номенклатура, последняя — цена
        out = {}
        for i in range(2, len(df)):
            name = df.iloc[i, 0]
            if pd.isna(name):
                continue
            name = str(name).strip()
            if not name:
                continue
            val = df.iloc[i, -1]
            try:
                price = float(val)
            except (TypeError, ValueError):
                continue
            if price < 0:
                continue
            out[name] = price
        return out
    except Exception:
        return {}
