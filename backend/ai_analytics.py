"""
ИИ-аналитика по выпуску продукции.
Анализ последних 10 дней: по каждому дню, участку, видам номенклатуры и наименованиям — для точных выводов.
"""

import json
import os
from datetime import date
from typing import Any, Optional

import database as db

# Сколько дней детальных данных отдаём в промпт (по дням, участкам, номенклатуре)
AI_ANALYSIS_DAYS = 10


def _format_nomenclature(nom_list: list, unit: str) -> list[str]:
    """Список строк: вид номенклатуры / наименование — количество."""
    lines = []
    for n in nom_list or []:
        nt = (n.get("nomenclature_type") or n.get("product_name") or "—").strip() or "—"
        pn = (n.get("product_name") or n.get("nomenclature_type") or "—").strip() or "—"
        qty = n.get("quantity", 0)
        if nt == pn:
            lines.append(f"    • {nt}: {qty} {unit}")
        else:
            lines.append(f"    • {nt} / {pn}: {qty} {unit}")
    return lines


def _build_context_10_days(target_date: date) -> str:
    """
    Собрать максимально подробный контекст за последние 10 дней:
    по каждому дню → производство → участок (цех) → итог + полная номенклатура (вид, наименование, кол-во).
    """
    days_data = db.get_last_n_days_detailed_for_ai(target_date, days=AI_ANALYSIS_DAYS)
    stats_today = db.get_daily_stats(target_date)
    employee_output = stats_today.get("employee_output", {})
    comparison = employee_output.get("comparison", [])

    parts = [
        "=== ДЕТАЛЬНЫЕ ДАННЫЕ ПО ДНЯМ И УЧАСТКАМ (последние 10 дней) ===",
        "По каждому дню указаны: производство, участок (цех), итог по участку, затем вид номенклатуры / наименование и количество.",
        "",
    ]

    for day_block in days_data:
        d = day_block.get("date", "")
        parts.append(f"--- День: {d} ---")
        for prod_name in ["ЧАЙ", "ГРАВИРОВКА", "ЛЮМИНАРК"]:
            prod = day_block.get("productions", {}).get(prod_name, {})
            depts = prod.get("departments", [])
            if not depts:
                parts.append(f"  [{prod_name}]: данных нет.")
                continue
            parts.append(f"  [{prod_name}]")
            for dept in depts:
                name = dept.get("name", "—")
                unit = dept.get("unit", "шт")
                total = dept.get("total", 0)
                total_units = dept.get("total_units")
                if total_units is not None:
                    parts.append(f"    Участок: {name} | итог: {total_units} ед. продукции (выпуск в шт: {total} {unit})")
                else:
                    parts.append(f"    Участок: {name} | итог: {total} {unit}")
                nom = dept.get("nomenclature", [])
                if nom:
                    parts.extend(_format_nomenclature(nom, unit))
                nom_by_op = dept.get("nomenclature_by_op") or {}
                for op_name, op_list in nom_by_op.items():
                    if op_list:
                        parts.append(f"    Операция: {op_name}")
                        parts.extend(_format_nomenclature(op_list, "шт"))
                subs = dept.get("subs") or []
                for s in subs:
                    parts.append(f"    Подблок: {s.get('sub_name', '—')} — {s.get('total', 0)} {s.get('unit', 'шт')}")
        parts.append("")

    parts.append("=== СРАВНЕНИЕ: ВЫПУСК VS ВЫРАБОТКА (за выбранный день) ===")
    for c in comparison:
        parts.append(f"  {c.get('production')} / {c.get('department')}: выпуск {c.get('release')} — выработка {c.get('output')} {c.get('unit', '')}")
    parts.append("")

    return "\n".join(parts)


def _build_context(target_date: date) -> tuple[list[dict], str]:
    """Собрать контекст: один большой текст за 10 дней (детально) для промпта. Возвращает ([], context_text)."""
    context_text = _build_context_10_days(target_date)
    return [], context_text


SYSTEM_PROMPT = """Ты — аналитик производственной отчётности. Тебе даны ДЕТАЛЬНЫЕ данные по выпуску продукции за последние 10 дней по трём производствам: ЧАЙ, ГРАВИРОВКА, ЛЮМИНАРК.
По каждому дню указаны участки (цехи), итоги по участку и полная номенклатура: вид номенклатуры, наименование, количество. Есть также разбивка по операциям (РЕЗКА, Сборка, Пресс и т.д.) где применимо.

Твои задачи:
1) Проанализировать все 10 дней: по каждому дню, по каждому участку, какие виды номенклатуры и наименования производились и в каких объёмах.
2) Сделать выводы: какие виды номенклатуры / наименования производятся чаще и в больших объёмах (легче/быстрее), какие реже или в малых объёмах (сложнее/дольше). Учитывать типы операций и участки.
3) Подмечать тренды по дням, скачки, аномалии, неадекватность данных. Оценить выработку за последний день относительно предыдущих.
4) Для каждого производства сформулировать 3–4 конкретных вопроса для руководителя производства (причины отклонений, узкие места, планы).
Отвечай строго в формате JSON."""

# В шаблоне буквальные {{ }} экранированы — иначе .format() даёт KeyError
USER_PROMPT_TEMPLATE = """Ниже — полные данные за последние 10 дней (по дням, участкам, видам номенклатуры и наименованиям). Дата выбранного дня (для оценки «сегодня»): {date_str}.

{context}

Верни один JSON-объект без markdown-обёртки, со следующей структурой (все строки на русском):
{{
  "productions": {{
    "ЧАЙ": {{
      "assessment": "2–4 предложения: оценка выработки за последний день и выводы по 10 дням; какие виды/наименования идут легче и быстрее, какие сложнее.",
      "trend_summary": "Кратко: тренд за 10 дней по участкам и номенклатуре (рост/падение/стабильно, по каким видам).",
      "issues": ["замечания: скачки, аномалии, неполные данные, проблемные участки или виды номенклатуры"],
      "questions": ["вопрос 1 для руководителя?", "вопрос 2?", "вопрос 3?", "вопрос 4?"]
    }},
    "ГРАВИРОВКА": {{ ... то же поля ... }},
    "ЛЮМИНАРК": {{ ... то же поля ... }}
  }},
  "general_notes": "Общие выводы по всем производствам за 10 дней: какие виды операций/номенклатуры стабильны, какие — узкие места (иначе пустая строка)."
}}
Если по производству нет данных — в assessment и trend_summary укажи «Нет данных за выбранный период», issues и questions можно пустые или общие.
Списки issues и questions — массивы строк, не более 5 issues и 4 questions на производство."""


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
            max_tokens=8192,
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
