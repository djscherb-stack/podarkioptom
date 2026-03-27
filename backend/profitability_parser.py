"""
Парсер файлов для модуля рентабельности.

Три источника данных:
1. Еженедельный детализированный отчёт (Wildberries)
2. Виды номенклатуры (1C — иерархический отчёт)
3. Себестоимость (1C — отчёт по расходу)
"""

import io
import re
import pandas as pd
from typing import Optional


# ---------------------------------------------------------------------------
# Маппинг бренда → направление
# ---------------------------------------------------------------------------

LUMINARC_BRANDS = {"luminarc", "люминарк", "осз", "osz"}
TEA_BRANDS = {"tvoychay", "tvoy chay", "твойчай", "твой чай"}

def brand_to_direction(brand: str) -> str:
    """Нормализует бренд и возвращает направление: luminarc / tea / engraving."""
    if not brand or not isinstance(brand, str):
        return "engraving"
    normalized = brand.strip().lower()
    # убираем пробелы/дефисы для сравнения
    compact = re.sub(r"[\s\-_]+", "", normalized)
    if normalized in LUMINARC_BRANDS or compact in {re.sub(r"[\s\-_]+", "", b) for b in LUMINARC_BRANDS}:
        return "luminarc"
    if normalized in TEA_BRANDS or compact in {re.sub(r"[\s\-_]+", "", b) for b in TEA_BRANDS}:
        return "tea"
    return "engraving"


# ---------------------------------------------------------------------------
# Парсер еженедельного отчёта
# ---------------------------------------------------------------------------

# Индексы колонок (0-based) по названиям из заголовка
_COL_BRAND = "Бренд"
_COL_ARTICLE = "Артикул поставщика"
_COL_TYPE = "Тип документа"               # J — "Продажа" / "Возврат"
_COL_TYPE_ALT = "Обоснование для оплаты"  # K — альтернатива
_COL_SALE_DATE = "Дата продажи"           # M
_COL_QTY = "Кол-во"                        # N
_COL_PRICE = "Цена розничная"              # O
_COL_ACQUIRING = "Эквайринг/Комиссии за организацию платежей"   # AC
_COL_PAYOUT = "К перечислению Продавцу за реализованный Товар"  # AH
_COL_LOGISTICS = "Услуги по доставке товара покупателю"          # AK
_COL_LOGISTICS_KINDS = "Виды логистики, штрафов и корректировок ВВ"  # AQ
_COL_ADS = "Реклама"                       # BI — если есть (старый формат)
_COL_WITHHOLDINGS = "Удержания"           # Удержания — реклама в новом формате

# Паттерны в "Виды логистики" которые означают рекламу
_ADS_LOGISTICS_PATTERNS = ["wb медиа", "wb продвижение", "wibes"]

# Строки-типы которые нужно удалить (по колонке AQ)
_SKIP_LOGISTICS_KINDS = {"возмещение издержек по перевозке"}


def parse_weekly_report(file_bytes: bytes) -> pd.DataFrame:
    """
    Парсит еженедельный отчёт WB.
    Возвращает DataFrame с колонками:
      артикул, бренд, направление, тип_операции,
      количество, цена, реализация,
      эквайринг, к_перечислению, услуги_мп, логистика, реклама
    """
    df = pd.read_excel(io.BytesIO(file_bytes), header=0, dtype=str)
    # Убираем пробелы из заголовков
    df.columns = [str(c).strip() for c in df.columns]

    def col(name: str, alt: Optional[str] = None) -> Optional[str]:
        """Возвращает имя колонки если есть, иначе alt или None."""
        if name in df.columns:
            return name
        if alt and alt in df.columns:
            return alt
        return None

    type_col = col(_COL_TYPE, _COL_TYPE_ALT)
    brand_col = col(_COL_BRAND)
    article_col = col(_COL_ARTICLE)
    sale_date_col = col(_COL_SALE_DATE)
    qty_col = col(_COL_QTY)
    price_col = col(_COL_PRICE)
    acq_col = col(_COL_ACQUIRING)
    payout_col = col(_COL_PAYOUT)
    logistics_col = col(_COL_LOGISTICS)
    logistics_kinds_col = col(_COL_LOGISTICS_KINDS)
    ads_col = col(_COL_ADS)

    if not all([brand_col, article_col, qty_col, price_col]):
        raise ValueError(
            f"Не найдены обязательные колонки. Найдены: {list(df.columns[:20])}"
        )

    # --- Определяем строки-продажи и строки-сервисные ---
    # Колонка "Тип документа" содержит "Продажа" или "Возврат" для реальных транзакций.
    # Остальные строки (NaN) — хранение, штрафы, логистические корректировки.
    # "Возмещение издержек по перевозке" — в колонке "Обоснование для оплаты" или
    # "Виды логистики", удаляем полностью.

    # 1. Удалить "возмещение издержек" — встречается в Обоснование и в Виды логистики
    obosnov_col = col("Обоснование для оплаты")
    if obosnov_col:
        mask_obosnov = df[obosnov_col].str.strip().str.lower().str.contains(
            "возмещение издержек", na=False
        )
        df = df[~mask_obosnov].copy()
    if logistics_kinds_col:
        mask_kinds = df[logistics_kinds_col].str.strip().str.lower().isin(_SKIP_LOGISTICS_KINDS)
        df = df[~mask_kinds].copy()

    def to_float(series: pd.Series) -> pd.Series:
        return pd.to_numeric(series.str.replace(",", "."), errors="coerce").fillna(0.0)

    qty_raw = to_float(df[qty_col])
    price = to_float(df[price_col])
    acq = to_float(df[acq_col]) if acq_col else pd.Series(0.0, index=df.index)
    payout = to_float(df[payout_col]) if payout_col else pd.Series(0.0, index=df.index)
    logistics = to_float(df[logistics_col]) if logistics_col else pd.Series(0.0, index=df.index)

    # Реклама: сначала пробуем колонку "Реклама" (старый формат WB),
    # затем — "Удержания" для строк WB Медиа / WB Продвижение (новый формат)
    if ads_col:
        ads = to_float(df[ads_col])
    else:
        ads = pd.Series(0.0, index=df.index)
        withholdings_col = col(_COL_WITHHOLDINGS)
        if withholdings_col and logistics_kinds_col:
            kinds_lower = df[logistics_kinds_col].str.strip().str.lower().fillna("")
            is_ads_row = kinds_lower.apply(
                lambda v: any(p in v for p in _ADS_LOGISTICS_PATTERNS)
            )
            ads = to_float(df[withholdings_col]).where(is_ads_row, 0.0)

    # 2. Количество — ТОЛЬКО для строк "Продажа" / "Возврат"
    #    Сервисные строки (логистика, штрафы, хранение) не должны увеличивать кол-во
    if type_col:
        type_lower = df[type_col].str.strip().str.lower().fillna("")
        is_sale = type_lower == "продажа"
        is_return = type_lower == "возврат"
        is_transaction = is_sale | is_return
        qty = qty_raw.where(is_transaction, 0.0)
        # Возврат → отрицательное
        qty = qty.where(~is_return, -qty.abs())
    else:
        qty = qty_raw

    реализация = qty * price
    услуги_мп = реализация - acq - payout

    sale_dates = pd.to_datetime(
        df[sale_date_col], errors="coerce"
    ) if sale_date_col else pd.Series(pd.NaT, index=df.index)

    result = pd.DataFrame({
        "артикул": df[article_col].str.strip().fillna(""),
        "бренд": df[brand_col].str.strip().fillna(""),
        "дата_продажи": sale_dates,
        "количество": qty,
        "цена": price,
        "реализация": реализация,
        "эквайринг": acq,
        "к_перечислению": payout,
        "услуги_мп": услуги_мп,
        "логистика": logistics,
        "реклама": ads,
    })

    result["направление"] = result["бренд"].apply(brand_to_direction)
    return result


def detect_week_from_report(file_bytes: bytes) -> Optional[str]:
    """
    Определяет ISO-неделю из данных WB-отчёта по колонке "Дата продажи".
    Возвращает строку вида "2026-W12" или None.
    Выбирает неделю с наибольшим числом строк продаж.
    """
    try:
        df = pd.read_excel(io.BytesIO(file_bytes), header=0, dtype=str)
        df.columns = [str(c).strip() for c in df.columns]
        date_col = _COL_SALE_DATE if _COL_SALE_DATE in df.columns else None
        if not date_col:
            return None
        dates = pd.to_datetime(df[date_col], errors="coerce").dropna()
        if dates.empty:
            return None
        # ISO-неделя с наибольшим числом строк
        weeks = dates.dt.isocalendar()
        week_counts = (weeks["year"].astype(str) + "-W" +
                       weeks["week"].astype(str).str.zfill(2))
        dominant = week_counts.value_counts().idxmax()
        return dominant
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Парсер видов номенклатуры
# ---------------------------------------------------------------------------

def parse_nomenclature_file(file_bytes: bytes) -> dict[str, str]:
    """
    Парсит файл видов номенклатуры. Поддерживает два формата:

    1. Плоский (артикул | вид):
       Заголовок "Артикул" / "Вид номенклатуры" в первой строке,
       далее строки с артикулом и видом в двух колонках.

    2. Иерархический 1C (лист Лист_1 (2)):
       Строки-заголовки вида: col0 = вид, col1 = NaN
       Строки-артикулы: col0 = артикул, col1 = артикул (одинаковые)
    """
    xl = pd.ExcelFile(io.BytesIO(file_bytes))

    # Предпочтительный лист для 1C-формата
    preferred = ["Лист_1 (2)", "Лист_1", "Лист2"]
    sheet = None
    for p in preferred:
        if p in xl.sheet_names:
            sheet = p
            break
    if sheet is None:
        sheet = xl.sheet_names[0]

    df = pd.read_excel(io.BytesIO(file_bytes), sheet_name=sheet, header=None)

    # Определяем формат по первой непустой строке
    # Плоский формат: первая строка содержит "артикул" в col0 и непустое значение в col1
    first_row = df.iloc[0] if len(df) > 0 else None
    is_flat = False
    if first_row is not None:
        v0 = str(first_row.iloc[0]).strip().lower() if not pd.isna(first_row.iloc[0]) else ""
        v1 = str(first_row.iloc[1]).strip().lower() if len(first_row) > 1 and not pd.isna(first_row.iloc[1]) else ""
        if "артикул" in v0 and v1:
            is_flat = True

    mapping: dict[str, str] = {}

    if is_flat:
        # Плоский формат: пропускаем строку заголовка и пустые строки
        for _, row in df.iloc[1:].iterrows():
            art = row.iloc[0] if len(row) > 0 else None
            vid = row.iloc[1] if len(row) > 1 else None
            if pd.isna(art) or pd.isna(vid):
                continue
            art = str(art).strip()
            vid = str(vid).strip()
            if art and vid:
                mapping[art] = vid
    else:
        # Иерархический 1C-формат
        current_vid = None
        _SKIP = {"Артикул", "Категория", "Номенклатура.Вид номенклатуры",
                 "Номенклатура.Артикул", "Отчет по категориям товаров"}
        for _, row in df.iterrows():
            v0 = row.iloc[0] if len(row) > 0 else None
            v1 = row.iloc[1] if len(row) > 1 else None
            if pd.isna(v0):
                continue
            v0 = str(v0).strip()
            if not v0 or v0 in _SKIP:
                continue
            if pd.isna(v1) or str(v1).strip() == "":
                current_vid = v0
            else:
                if current_vid:
                    mapping[v0] = current_vid

    return mapping


# ---------------------------------------------------------------------------
# Парсер себестоимости
# ---------------------------------------------------------------------------

def parse_costs_file(
    file_bytes: bytes,
    nomenclature_map: Optional[dict[str, str]] = None,
) -> dict[str, dict]:
    """
    Парсит отчёт 1C "Себестоимость" (расход).

    Колонки:
      A(0) = Вид номенклатуры или Артикул
      I(8) = Количество (расход)
      N(13) = Себестоимость (расход)

    Файл двухуровневый: строка вида → строки артикулов (если есть).
    Артикульные строки определяются по nomenclature_map — если имя из col0
    присутствует как ключ (артикул) в номенклатурном маппинге.

    Возвращает dict: имя → {qty, total_cost, unit_cost, level}
      level = 'vid'     — строка вида номенклатуры
      level = 'article' — строка отдельного артикула

    В calculate_profitability для каждого артикула приоритет у article-записи,
    fallback — на vid-запись через маппинг вид номенклатуры.

    Edge-cases:
      - qty = 0 → unit_cost = 0
      - дубли → агрегация
    """
    df = pd.read_excel(io.BytesIO(file_bytes), header=None)

    # Первые 4 строки — служебные заголовки 1C
    data = df.iloc[4:].copy()
    data.columns = range(len(data.columns))

    # case-insensitive множество известных артикулов из файла видов
    article_names_lower: set[str] = set()
    if nomenclature_map:
        article_names_lower = {k.lower() for k in nomenclature_map.keys()}

    costs: dict[str, dict] = {}

    # Строки-итоги 1C (организации, итоговые строки) — пропускаем
    _SKIP_NAMES = {"подарки оптом ооо"}

    for _, row in data.iterrows():
        name = row.iloc[0] if len(row) > 0 else None
        qty_val = row.iloc[8] if len(row) > 8 else None
        cost_val = row.iloc[13] if len(row) > 13 else None

        if pd.isna(name) or not str(name).strip():
            continue

        name = str(name).strip()

        if name.lower() in _SKIP_NAMES:
            continue

        try:
            qty = float(qty_val) if not pd.isna(qty_val) else 0.0
            cost = float(cost_val) if not pd.isna(cost_val) else 0.0
        except (ValueError, TypeError):
            continue

        # Определяем уровень: артикул (из номенклатурного файла) или вид
        level = "article" if name.lower() in article_names_lower else "vid"

        if name in costs:
            costs[name]["qty"] += qty
            costs[name]["total_cost"] += cost
        else:
            costs[name] = {"qty": qty, "total_cost": cost, "level": level}

    # Рассчитываем unit_cost
    for c in costs.values():
        c["unit_cost"] = c["total_cost"] / c["qty"] if c["qty"] != 0 else 0.0

    return costs


# ---------------------------------------------------------------------------
# Расчёт рентабельности
# ---------------------------------------------------------------------------

def calculate_profitability(
    report_df: pd.DataFrame,
    nomenclature_map: dict[str, str],
    costs_map: dict[str, dict],
    custom_mappings: dict[str, str],
    work_rates: dict[str, float],  # {luminarc: X, engraving: X, tea: X}
) -> tuple[list[dict], list[str]]:
    """
    Рассчитывает рентабельность по артикулам и видам номенклатуры.

    Возвращает:
      - rows: список строк для таблицы (иерархия: вид → артикулы)
      - unmatched: список артикулов без вида номенклатуры
    """
    df = report_df.copy()

    # Объединённый маппинг (case-insensitive): сначала кастомный, потом из файла
    combined_map_lower = {k.lower(): v for k, v in nomenclature_map.items()}
    combined_map_lower.update({k.lower(): v for k, v in custom_mappings.items()})

    df["вид"] = df["артикул"].str.lower().map(combined_map_lower).fillna("")

    # Авто-маппинг по бренду (для артикулов без вида)
    # Бренд "Luminarc" / "Люминарк" → вид содержащий "люминарк" + "переупаковк"
    luminarc_repacking_vid = None
    for vid in set(nomenclature_map.values()):
        vid_lower = vid.lower()
        if "люминарк" in vid_lower and "переупаковк" in vid_lower:
            luminarc_repacking_vid = vid
            break
    if luminarc_repacking_vid:
        art_has_luminarc = df["артикул"].str.lower().str.contains("luminarc", na=False)
        mask_lum = (
            (df["направление"] == "luminarc") | art_has_luminarc
        ) & (df["вид"] == "")
        df.loc[mask_lum, "вид"] = luminarc_repacking_vid

    # Бренд "Люминар" (не Люминарк) → вид содержащий "ламинар" + "переупаковк"
    laminar_repacking_vid = None
    for vid in set(nomenclature_map.values()):
        vid_lower = vid.lower()
        if "ламинар" in vid_lower and "переупаковк" in vid_lower:
            laminar_repacking_vid = vid
            break
    if laminar_repacking_vid:
        brand_lower = df["бренд"].str.strip().str.lower()
        mask_laminar = (
            brand_lower.str.contains("люминар", na=False)
            & ~brand_lower.str.contains("люминарк", na=False)
            & (df["вид"] == "")
        )
        df.loc[mask_laminar, "вид"] = laminar_repacking_vid

    unmatched = sorted(df[df["вид"] == ""]["артикул"].unique().tolist())

    # Суммируем общую рекламу из отчёта (3 строки — не привязаны к артикулам)
    # Они распределятся пропорционально реализации после группировки
    total_реклама = df["реклама"].sum()

    # Группировка по артикулу (без реклама — распределим после)
    grp_cols = ["артикул", "бренд", "направление", "вид"]
    agg = df.groupby(grp_cols, as_index=False).agg(
        количество=("количество", "sum"),
        реализация=("реализация", "sum"),
        эквайринг=("эквайринг", "sum"),
        услуги_мп=("услуги_мп", "sum"),
        логистика=("логистика", "sum"),
    )

    # Распределяем рекламу пропорционально реализации
    total_реал_все = agg["реализация"].sum()
    if total_реал_все != 0 and total_реклама != 0:
        agg["реклама"] = agg["реализация"] / total_реал_все * total_реклама
    else:
        agg["реклама"] = 0.0

    # Себестоимость единицы (материальная):
    # 1. article-level по артикулу (case-insensitive) — приоритет
    # 2. fallback: vid-level по виду номенклатуры
    costs_lower = {k.lower(): v for k, v in costs_map.items()}

    def get_unit_cost(art: str, vid: str) -> float:
        art_rec = costs_lower.get(art.lower())
        if art_rec and art_rec.get("level") == "article":
            return art_rec["unit_cost"]
        if vid:
            vid_rec = costs_map.get(vid) or costs_lower.get(vid.lower())
            if vid_rec:
                return vid_rec["unit_cost"]
        return 0.0

    agg["себестоимость_единица"] = agg.apply(
        lambda r: get_unit_cost(r["артикул"], r["вид"]), axis=1
    )
    agg["себестоимость"] = agg["себестоимость_единица"] * agg["количество"]

    # ЗП (стоимость работы)
    def get_work_rate(direction: str) -> float:
        return float(work_rates.get(direction, 0.0))

    agg["работа"] = agg["количество"] * agg["направление"].apply(get_work_rate)

    # Итого себестоимость = материальная + работа
    agg["итого_себестоимость"] = agg["себестоимость"] + agg["работа"]

    # Доля себестоимости в реализации (%)
    agg["доля_себестоимости"] = agg.apply(
        lambda r: r["итого_себестоимость"] / r["реализация"] * 100
        if r["реализация"] != 0 else 0.0,
        axis=1,
    )

    # Средняя цена = реализация / количество
    agg["средняя_цена"] = agg.apply(
        lambda r: r["реализация"] / r["количество"] if r["количество"] != 0 else 0.0,
        axis=1,
    )

    # Финальные метрики
    agg["маржа_до_рекламы"] = (
        agg["реализация"]
        - agg["себестоимость"]
        - agg["логистика"]
        - agg["услуги_мп"]
        - agg["работа"]
    )
    agg["маржа_после_рекламы"] = agg["маржа_до_рекламы"] - agg["реклама"]
    agg["рентабельность_пct"] = agg.apply(
        lambda r: r["маржа_после_рекламы"] / r["реализация"] * 100
        if r["реализация"] != 0 else 0.0,
        axis=1,
    )

    # Показатели на единицу (только рублёвые метрики)
    def per_unit(val: float, qty: float) -> float:
        return val / qty if qty != 0 else 0.0

    rub_metric_cols = [
        "реализация", "себестоимость", "работа", "итого_себестоимость",
        "логистика", "услуги_мп", "реклама",
        "маржа_до_рекламы", "маржа_после_рекламы",
    ]
    for c in rub_metric_cols:
        agg[f"{c}_на_ед"] = agg.apply(
            lambda r, col=c: per_unit(r[col], r["количество"]), axis=1
        )

    # Группировка по виду номенклатуры
    vid_groups: dict[str, list[dict]] = {}
    for _, row in agg.iterrows():
        vid = row["вид"] or "Без вида"
        if vid not in vid_groups:
            vid_groups[vid] = []
        vid_groups[vid].append(row.to_dict())

    # Суммируемые колонки для итогов по виду
    sum_cols = [
        "количество", "реализация", "эквайринг", "услуги_мп",
        "логистика", "реклама", "себестоимость", "работа",
        "итого_себестоимость", "маржа_до_рекламы", "маржа_после_рекламы",
    ]

    rows: list[dict] = []
    for vid, articles in sorted(vid_groups.items()):
        totals: dict = {"вид": vid, "тип": "вид", "артикулы": []}
        for col in sum_cols:
            totals[col] = sum(a[col] for a in articles)

        реал = totals["реализация"]
        qty = totals["количество"]
        totals["рентабельность_пct"] = (
            totals["маржа_после_рекламы"] / реал * 100 if реал != 0 else 0.0
        )
        totals["доля_себестоимости"] = (
            totals["итого_себестоимость"] / реал * 100 if реал != 0 else 0.0
        )
        totals["средняя_цена"] = реал / qty if qty != 0 else 0.0

        for c in rub_metric_cols:
            totals[f"{c}_на_ед"] = per_unit(totals[c], qty)

        for art in sorted(articles, key=lambda x: -x["реализация"]):
            art["тип"] = "артикул"
            totals["артикулы"].append(art)

        rows.append(totals)

    return rows, unmatched
