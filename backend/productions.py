"""Конфигурация производств и логика группировки."""

import re
from typing import Any, Optional, Tuple
import pandas as pd

# Структура производств: название -> список подразделений с настройками
# dept_match: точное или частичное совпадение названия подразделения
# unit: "шт" | "кг" (для отображения)
# transform: "grams_to_kg" | None
# split: логика разделения на подблоки

PRODUCTIONS = {
    "ЧАЙ": {
        "order": [
            {"keys": ["Купажный цех Елино"], "name": "Купажный цех Елино", "unit": "кг", "transform": "grams_to_kg"},
            {"keys": ["Фасовочный цех Елино"], "name": "Фасовочный цех Елино", "unit": "шт", "split": "faskovka"},
            {"keys": ["Шелкография Елино"], "name": "Шелкография Елино", "unit": "шт", "exact": True},
            {"keys": ["Картон/Дерево Елино"], "name": "Картон/Дерево Елино", "unit": "шт", "exact": True},
            {"keys": ["Сборочный цех Елино"], "name": "Сборочный цех Елино", "unit": "шт", "exact": True, "main": True},
        ],
    },
    "ГРАВИРОВКА": {
        "order": [
            {"keys": ["Гравировочный цех Елино Гравировка", "Гравировочный цех Елино"], "name": "Гравировочный цех Елино", "unit": "шт"},
            {"keys": ["Картон/Дерево Елино Гравировка"], "name": "Картон/Дерево Елино Гравировка", "unit": "шт", "split": "grav_karton"},
            {"keys": ["Шелкография Елино Гравировка"], "name": "Шелкография Елино Гравировка", "unit": "шт"},
            {"keys": ["Сборочный цех Елино Гравировка"], "name": "Сборочный цех Елино Гравировка", "unit": "шт", "main": True},
        ],
    },
    "ЛЮМИНАРК": {
        "order": [
            {"keys": ["Сборочный цех Люминарк"], "name": "Сборочный цех Люминарк", "unit": "шт", "main": True},
        ],
    },
}


def _match_department(dept: str, cfg: dict) -> bool:
    """Проверка соответствия подразделения конфигу."""
    keys = cfg.get("keys", cfg.get("key", []) if isinstance(cfg.get("key"), list) else [cfg.get("key", "")])
    if isinstance(keys, str):
        keys = [keys]
    exact = cfg.get("exact", False)
    for key in keys:
        if exact and dept == key:
            return True
        if not exact and key in dept:
            return True
    return False


def _get_production_and_config(department: str) -> Tuple[Optional[str], Optional[dict]]:
    """Найти производство и конфиг для подразделения."""
    for prod_name, prod_cfg in PRODUCTIONS.items():
        for cfg in prod_cfg["order"]:
            if _match_department(department, cfg):
                return prod_name, cfg
    return None, None


def _split_faskovka(df: pd.DataFrame) -> list[dict]:
    """Фасовочный цех: Фасовка КУБОВ (номенклатура содержит КУБ) vs Фасовка банок."""
    kub = df[df["nomenclature_type"].str.contains("КУБ", case=False, na=False)]
    bank = df[~df["nomenclature_type"].str.contains("КУБ", case=False, na=False)]
    result = []
    if not kub.empty:
        total = kub["quantity"].sum()
        result.append({"sub_name": "Фасовка КУБОВ", "total": int(total), "unit": "шт"})
    if not bank.empty:
        total = bank["quantity"].sum()
        result.append({"sub_name": "Фасовка банок", "total": int(total), "unit": "шт"})
    return result


def _calc_sbor_units(combined_df: pd.DataFrame) -> int:
    """Сборочный цех Елино: только «Комплект 4 шт» — каждая единица считается как 4 штуки. Остальная номенклатура — mult=1."""
    nom = combined_df["nomenclature_type"].fillna("").astype(str)
    qty = combined_df["quantity"]
    total = 0
    for n, q in zip(nom, qty):
        mult = 4 if "комплект 4 шт" in n.lower() else 1
        total += q * mult
    return int(total)


def _split_grav_karton(df: pd.DataFrame) -> list[dict]:
    """Картон/Дерево Гравировка: МДФ-вырезанная→РЕЗКА, МДФ→сборка, остальное→пресс.
    Проверяем product_name (наименование), т.к. «МДФ - вырезанная» там."""
    product_col = "product_name" if "product_name" in df.columns else "nomenclature_type"
    prod = df[product_col].fillna("").astype(str)
    rezka = df[prod.str.contains("МДФ", case=False) & prod.str.contains("вырезанн", case=False)]
    sborka = df[prod.str.contains("МДФ", case=False) & ~prod.str.contains("вырезанн", case=False)]
    press = df[~prod.str.contains("МДФ", case=False)]
    return [
        {"sub_name": "РЕЗКА", "total": int(rezka["quantity"].sum()), "unit": "шт"},
        {"sub_name": "Сборка", "total": int(sborka["quantity"].sum()), "unit": "шт"},
        {"sub_name": "Пресс", "total": int(press["quantity"].sum()), "unit": "шт"},
    ]


def _process_production_data(df: pd.DataFrame) -> dict[str, Any]:
    """Обработка данных по производствам. Объединяем подразделения в блоки по конфигу."""
    result = {}
    for prod_name, prod_cfg in PRODUCTIONS.items():
        result[prod_name] = {"departments": [], "order": prod_cfg["order"]}

    # Собираем данные по блокам (несколько подразделений могут войти в один блок)
    blocks_data = {}  # (prod_name, block_name) -> list of (dept, df)
    for dept, dept_df in df.groupby("department"):
        prod_name, cfg = _get_production_and_config(dept)
        if prod_name is None:
            continue
        block_name = cfg.get("name", dept)
        key = (prod_name, block_name)
        if key not in blocks_data:
            blocks_data[key] = {"cfg": cfg, "dfs": []}
        blocks_data[key]["dfs"].append((dept, dept_df))

    for (prod_name, block_name), data in blocks_data.items():
        cfg = data["cfg"]
        combined_df = pd.concat([d for _, d in data["dfs"]], ignore_index=True)
        dept_raw = ", ".join(d for d, _ in data["dfs"])

        total = combined_df["quantity"].sum()
        unit = cfg.get("unit", "шт")
        transform = cfg.get("transform")
        split_type = cfg.get("split")

        if transform == "grams_to_kg":
            total = total / 1000
            display_total = round(total, 2)
        else:
            display_total = int(total)

        block = {
            "name": block_name,
            "department_raw": dept_raw,
            "total": display_total,
            "unit": unit,
            "main": cfg.get("main", False),
        }

        # Сборочный цех Елино: вторая цифра — «Комплект N шт» считается как N единиц
        if block_name == "Сборочный цех Елино" and not split_type:
            block["total_units"] = _calc_sbor_units(combined_df)

        if split_type == "faskovka":
            subs = _split_faskovka(combined_df)
            if subs:
                block["subs"] = subs
        elif split_type == "grav_karton":
            block["subs"] = _split_grav_karton(combined_df)

        if split_type != "grav_karton":
            df_work = combined_df.copy()
            if "product_name" not in df_work.columns:
                df_work["product_name"] = ""
            df_work["product_name"] = df_work["product_name"].fillna("").astype(str)
            df_work["nomenclature_type"] = df_work["nomenclature_type"].fillna("").astype(str)
            cols = ["nomenclature_type", "product_name"]
            nom_totals = (
                df_work.groupby(cols, as_index=False)["quantity"]
                .sum()
                .sort_values("quantity", ascending=False)
            )
            block["nomenclature"] = []
            for _, row in nom_totals.iterrows():
                nom_type = str(row["nomenclature_type"]) if pd.notna(row["nomenclature_type"]) else ""
                pn = str(row["product_name"]) if pd.notna(row["product_name"]) else ""
                if not nom_type.strip() and not pn.strip():
                    continue
                qty = row["quantity"]
                qty = round(qty / 1000, 2) if transform == "grams_to_kg" else int(qty)
                block["nomenclature"].append({
                    "nomenclature_type": nom_type or pn or "—",
                    "product_name": pn or nom_type or "—",
                    "quantity": qty,
                    "unit": unit,
                })
        else:
            product_col = "product_name" if "product_name" in combined_df.columns else "nomenclature_type"
            prod = combined_df[product_col].fillna("").astype(str)
            block["nomenclature_by_op"] = {}
            for op_name, mask in [
                ("РЕЗКА", prod.str.contains("МДФ", case=False) & prod.str.contains("вырезанн", case=False)),
                ("Сборка", prod.str.contains("МДФ", case=False) & ~prod.str.contains("вырезанн", case=False)),
                ("Пресс", ~prod.str.contains("МДФ", case=False)),
            ]:
                sub_df = combined_df[mask]
                if sub_df.empty:
                    block["nomenclature_by_op"][op_name] = []
                else:
                    sub_work = sub_df.copy()
                    if "product_name" not in sub_work.columns:
                        sub_work["product_name"] = ""
                    sub_work["product_name"] = sub_work["product_name"].fillna("").astype(str)
                    sub_work["nomenclature_type"] = sub_work["nomenclature_type"].fillna("").astype(str)
                    noms = sub_work.groupby(["nomenclature_type", "product_name"], as_index=False)["quantity"].sum()
                    block["nomenclature_by_op"][op_name] = []
                    for _, r in noms.iterrows():
                        nt = str(r["nomenclature_type"]) if pd.notna(r["nomenclature_type"]) else ""
                        pn = str(r["product_name"]) if pd.notna(r["product_name"]) else ""
                        if nt.strip() or pn.strip():
                            block["nomenclature_by_op"][op_name].append({
                                "nomenclature_type": nt or pn or "—",
                                "product_name": pn or nt or "—",
                                "quantity": int(r["quantity"]),
                            })
            block["nomenclature"] = []

        result[prod_name]["departments"].append(block)

    # Сортировка по order (main в конец)
    for prod_name in result:
        deps = result[prod_name]["departments"]
        order_cfgs = result[prod_name]["order"]
        main_deps = [d for d in deps if d.get("main")]
        other_deps = [d for d in deps if not d.get("main")]
        other_sorted = []
        for cfg in order_cfgs:
            if cfg.get("main"):
                continue
            for d in other_deps:
                if d["name"] == cfg.get("name"):
                    other_sorted.append(d)
                    break
        for d in other_deps:
            if d not in other_sorted:
                other_sorted.append(d)
        result[prod_name]["departments"] = other_sorted + main_deps

    return result


def build_productions_stats(df: pd.DataFrame) -> dict[str, Any]:
    """Построить статистику по производствам из датафрейма."""
    return _process_production_data(df)


def get_block_config(production: str, block_name: str) -> Optional[dict]:
    """Получить конфиг блока по названию производства и блока."""
    prod_cfg = PRODUCTIONS.get(production)
    if not prod_cfg:
        return None
    for cfg in prod_cfg["order"]:
        if cfg.get("name") == block_name:
            return cfg
    return None


def get_raw_department_names(production: str, block_name: str) -> list[str]:
    """Получить список raw-названий подразделений для блока."""
    cfg = get_block_config(production, block_name)
    if not cfg:
        return []
    keys = cfg.get("keys", [])
    if isinstance(keys, str):
        keys = [keys]
    return keys
