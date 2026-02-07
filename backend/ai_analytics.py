"""
ИИ-аналитика по выпуску продукции за день.
По каждому производству: оценка выработки, тренд за 30 дней, проблемы/скачки, 3–4 вопроса для руководителя.
"""

import json
import os
from datetime import date
from typing import Any, Optional

import database as db


def _serialize_production_for_ai(prod_name: str, prod_data: dict, employee_comparison: list) -> dict:
    """Собрать по одному производству данные для промпта ИИ."""
    depts = prod_data.get("departments", [])
    main_dept = next((d for d in depts if d.get("main")), depts[0] if depts else None)
    if not main_dept:
        return {"production": prod_name, "departments": [], "main": None}

    # Основной показатель: у сборочного цеха может быть total_units (ед. продукции)
    today_val = main_dept.get("total_units") if main_dept.get("total_units") is not None else main_dept.get("total", 0)
    unit = main_dept.get("unit", "шт")
    if main_dept.get("total_units") is not None:
        unit = "ед."

    comp = main_dept.get("comparison", {})
    yesterday_val = comp.get("units_yesterday") if main_dept.get("total_units") is not None else comp.get("yesterday", 0)
    delta = comp.get("units_delta") if main_dept.get("total_units") is not None else comp.get("delta", 0)
    delta_pct = comp.get("delta_pct", 0)

    trend_30 = main_dept.get("trend_30d", [])
    avg_30 = main_dept.get("avg_30d", 0)
    vs_avg_delta = main_dept.get("vs_avg_delta")
    vs_avg_pct = main_dept.get("vs_avg_pct")

    last_7 = main_dept.get("last_7_days", [])
    last_7_vals = [d.get("total_units") if d.get("total_units") is not None else d.get("total", 0) for d in last_7]

    # Сравнение выпуск vs выработка по этому производству
    release_vs_output = [c for c in employee_comparison if c.get("production") == prod_name]

    return {
        "production": prod_name,
        "main_department": main_dept.get("name"),
        "today": today_val,
        "yesterday": yesterday_val,
        "delta": delta,
        "delta_pct": delta_pct,
        "unit": unit,
        "trend_30_days": trend_30[-14:] if len(trend_30) > 14 else trend_30,  # последние 14 точек
        "avg_30_days": avg_30,
        "vs_avg_delta": vs_avg_delta,
        "vs_avg_pct": vs_avg_pct,
        "last_7_days_values": last_7_vals,
        "departments_summary": [
            {
                "name": d.get("name"),
                "total": d.get("total"),
                "total_units": d.get("total_units"),
                "unit": d.get("unit"),
            }
            for d in depts
        ],
        "release_vs_output": release_vs_output,
    }


def _build_context(target_date: date) -> tuple[list[dict], str]:
    """Собрать контекст по всем производствам за дату. Возвращает (list для JSON, текст для промпта)."""
    stats = db.get_daily_stats(target_date)
    productions_data = stats.get("productions", {})
    employee_output = stats.get("employee_output", {})
    comparison = employee_output.get("comparison", [])

    date_str = target_date.isoformat()
    parts = [f"Дата: {date_str}\n"]

    for prod_name in ["ЧАЙ", "ГРАВИРОВКА", "ЛЮМИНАРК"]:
        prod_data = productions_data.get(prod_name, {})
        if not prod_data:
            parts.append(f"\n### {prod_name}: данных за этот день нет.")
            continue
        obj = _serialize_production_for_ai(prod_name, prod_data, comparison)
        parts.append(f"\n### {prod_name}")
        parts.append(f"  Сегодня: {obj['today']} {obj['unit']}, вчера: {obj['yesterday']}, Δ: {obj['delta']} ({obj.get('delta_pct')}%)")
        parts.append(f"  Среднее за 30 дней: {obj['avg_30_days']} {obj['unit']}, отклонение от среднего: {obj.get('vs_avg_delta')} ({obj.get('vs_avg_pct')}%)")
        parts.append(f"  Последние 7 дней: {obj['last_7_days_values']}")
        if obj.get("release_vs_output"):
            for r in obj["release_vs_output"]:
                parts.append(f"  Выпуск vs выработка: {r.get('department')} — выпуск {r.get('release')}, выработка {r.get('output')} {r.get('unit', '')}")

    return [
        _serialize_production_for_ai(pn, productions_data.get(pn, {}), comparison)
        for pn in ["ЧАЙ", "ГРАВИРОВКА", "ЛЮМИНАРК"]
    ], "\n".join(parts)


SYSTEM_PROMPT = """Ты — аналитик производственной отчётности. Тебе даны данные по выпуску продукции за день по трём производствам: ЧАЙ, ГРАВИРОВКА, ЛЮМИНАРК.
Твоя задача:
1) По каждому производству дать краткую оценку выработки за день с учётом тренда за последние 30 дней (нормально / выше нормы / ниже нормы / подозрительные данные).
2) Подмечать тренды (рост, спад, стабильность), возможные проблемы, скачки вверх/вниз, неадекватность данных (например, нули при обычных объёмах, резкое падение без выходных).
3) Для каждого производства сформулировать 3–4 конкретных вопроса для руководителя производства, чтобы он мог, ответив на них, улучшить показатели на следующий день. Вопросы должны быть по существу: про причины отклонений, про узкие места, про планы.
Отвечай строго в формате JSON."""

# В шаблоне буквальные { } экранированы как {{ }} — иначе .format() воспринимает их как плейсхолдеры и даёт KeyError
USER_PROMPT_TEMPLATE = """Данные за {date_str}:

{context}

Верни один JSON-объект без markdown-обёртки, со следующей структурой (все строки на русском):
{{
  "productions": {{
    "ЧАЙ": {{
      "assessment": "1–3 предложения: оценка выработки за день и относительно тренда",
      "trend_summary": "Кратко: тренд за 30 дней (рост/падение/стабильно)",
      "issues": ["список замечаний: скачки, аномалии, неполные данные"],
      "questions": ["вопрос 1?", "вопрос 2?", "вопрос 3?", "вопрос 4?"]
    }},
    "ГРАВИРОВКА": {{ ... то же ... }},
    "ЛЮМИНАРК": {{ ... то же ... }}
  }},
  "general_notes": "Общие замечания по данным за день, если есть (иначе пустая строка)"
}}
Если по производству нет данных за день — assessment и trend_summary укажи как «Нет данных за выбранный день», issues и questions можно пустые или с общим вопросом.
Списки issues и questions — всегда массивы строк, не более 5 issues и 4 questions на производство."""


def _parse_ai_json(text: str) -> Optional[dict]:
    """Извлечь и распарсить JSON из ответа ИИ. Устойчиво к обёрткам и лишнему тексту."""
    if not text or not text.strip():
        return None
    text = text.strip().strip("\ufeff")  # BOM
    # Убрать markdown-обёртку ```json ... ```
    if "```" in text:
        start = text.find("```")
        if start != -1:
            rest = text[start + 3:]
            if rest.lower().startswith("json"):
                rest = rest[4:].lstrip("\n")
            end = rest.find("```")
            text = rest[:end].strip() if end != -1 else rest.strip()
    # Оставить только один объект: от первой { до последней }
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        text = text[first : last + 1]
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None


def _call_llm(context_text: str, target_date: date) -> tuple[Optional[dict], Optional[str], Optional[str]]:
    """Вызов LLM. Возвращает (данные, None, None) или (None, сообщение, тип_ошибки для отладки)."""
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None, "OPENAI_API_KEY не задан", None

    try:
        from openai import OpenAI
    except ImportError:
        return None, "Не установлен пакет openai (pip install openai)", None

    client = OpenAI(api_key=api_key)
    user_prompt = USER_PROMPT_TEMPLATE.format(
        date_str=target_date.isoformat(),
        context=context_text,
    )

    try:
        response = client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=4096,
        )
        text = (response.choices[0].message.content or "").strip()
        data = _parse_ai_json(text)
        if data is not None:
            return data, None, None
        return None, "ИИ вернул некорректный ответ. Попробуйте запустить аналитику ещё раз.", None
    except Exception as e:
        err = str(e).strip()
        err_type = type(e).__name__
        if "401" in err or "Incorrect API key" in err or "invalid_api_key" in err.lower():
            return None, "Неверный API-ключ OpenAI. Проверьте OPENAI_API_KEY.", err_type
        if "429" in err or "rate" in err.lower():
            return None, "Превышен лимит запросов OpenAI. Подождите и попробуйте снова.", err_type
        if "503" in err or "timeout" in err.lower():
            return None, "Сервис OpenAI временно недоступен. Попробуйте позже.", err_type
        # JSONDecodeError и др. — часто при обрезанном/неверном ответе API
        if err_type == "JSONDecodeError" or ("productions" in err and len(err) < 100):
            return None, "Ответ API в неверном формате (возможна обрезка или сбой). Попробуйте ещё раз.", err_type
        return None, f"Ошибка OpenAI API: {err[:200]}", err_type


def get_ai_analytics(target_date: date) -> dict[str, Any]:
    """
    Получить ИИ-аналитику за выбранный день.
    Возвращает:
      - enabled: bool — настроен ли API ключ
      - date: str
      - productions: { ЧАЙ: { assessment, trend_summary, issues, questions }, ... }
      - general_notes: str
      - error: str — если что-то пошло не так
    """
    result = {
        "enabled": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
        "date": target_date.isoformat(),
        "productions": {},
        "general_notes": "",
        "error": None,
    }

    if not result["enabled"]:
        result["error"] = "OPENAI_API_KEY не задан. Добавьте ключ в .env для ИИ-аналитики."
        return result

    try:
        _, context_text = _build_context(target_date)
    except Exception as e:
        result["error"] = f"Ошибка подготовки данных: {e}"
        return result

    try:
        ai_response, err_msg, debug_type = _call_llm(context_text, target_date)
    except BaseException as e:
        result["error"] = "Внутренняя ошибка при запросе к ИИ. Попробуйте ещё раз."
        result["debug_error_type"] = type(e).__name__
        return result

    if err_msg:
        result["error"] = err_msg
        if debug_type:
            result["debug_error_type"] = debug_type
        return result
    if not ai_response or not isinstance(ai_response, dict):
        result["error"] = "Не удалось получить ответ от ИИ. Попробуйте ещё раз."
        return result

    productions = ai_response.get("productions")
    if not isinstance(productions, dict):
        productions = {}
    result["productions"] = productions
    result["general_notes"] = (ai_response.get("general_notes") or "") if isinstance(ai_response.get("general_notes"), str) else ""
    return result
