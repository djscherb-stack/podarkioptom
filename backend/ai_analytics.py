"""
ИИ-аналитика по выпуску продукции.
Анализ последних 10 дней: по каждому дню, участку, видам номенклатуры и наименованиям — для точных выводов.
"""

import json
import os
import time
from datetime import date
from typing import Any, Optional

import database as db

# Сколько дней детальных данных отдаём в промпт. Можно уменьшить через .env (AI_ANALYSIS_DAYS=5), чтобы реже упираться в лимит токенов/запросов.
def _get_analysis_days() -> int:
    try:
        return max(3, min(10, int(os.environ.get("AI_ANALYSIS_DAYS", "10"))))
    except ValueError:
        return 10

def _format_nomenclature_by_type_only(nom_list: list, unit: str) -> list[str]:
    """Только виды номенклатуры и суммарное количество по каждому виду (без наименований — экономим токены)."""
    by_type: dict[str, float] = {}
    for n in nom_list or []:
        nt = (n.get("nomenclature_type") or n.get("product_name") or "—").strip() or "—"
        qty = n.get("quantity", 0)
        try:
            qty = float(qty) if not isinstance(qty, (int, float)) else qty
        except (TypeError, ValueError):
            qty = 0
        by_type[nt] = by_type.get(nt, 0) + qty
    lines = []
    for nt, total in sorted(by_type.items(), key=lambda x: -x[1]):
        if nt == "—" and total == 0:
            continue
        total_int = int(total) if total == int(total) else round(total, 2)
        lines.append(f"    • {nt}: {total_int} {unit}")
    return lines


def _build_context_10_days(target_date: date) -> str:
    """
    Собрать подробный контекст за последние N дней (см. _get_analysis_days):
    по каждому дню → производство → участок (цех) → итог + номенклатура (вид, наименование, кол-во).
    """
    days = _get_analysis_days()
    days_data = db.get_last_n_days_detailed_for_ai(target_date, days=days)
    stats_today = db.get_daily_stats(target_date)
    employee_output = stats_today.get("employee_output", {})
    comparison = employee_output.get("comparison", [])

    parts = [
        f"=== ДАННЫЕ ПО ДНЯМ И УЧАСТКАМ (последние {days} дн.) ===",
        "По каждому дню: производство, участок (цех), итог, затем только вид номенклатуры и суммарное количество (без наименований).",
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
                    parts.extend(_format_nomenclature_by_type_only(nom, unit))
                nom_by_op = dept.get("nomenclature_by_op") or {}
                for op_name, op_list in nom_by_op.items():
                    if op_list:
                        parts.append(f"    Операция: {op_name}")
                        parts.extend(_format_nomenclature_by_type_only(op_list, "шт"))
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


SYSTEM_PROMPT = """Ты — аналитик производственной отчётности. Тебе даны данные по выпуску продукции за последние дни по трём производствам: ЧАЙ, ГРАВИРОВКА, ЛЮМИНАРК.
По каждому дню указаны участки (цехи), итоги по участку и виды номенклатуры с суммарным количеством (без наименований). Есть разбивка по операциям (РЕЗКА, Сборка, Пресс и т.д.) где применимо.

Твои задачи:
1) Проанализировать все дни: по каждому дню и участку — какие виды номенклатуры производились и в каких объёмах.
2) Сделать выводы: какие виды номенклатуры производятся чаще и в больших объёмах (легче/быстрее), какие реже или в малых объёмах (сложнее/дольше). Учитывать типы операций и участки.
3) Подмечать тренды по дням, скачки, аномалии. Оценить выработку за последний день относительно предыдущих.
4) Для каждого производства сформулировать 3–4 конкретных вопроса для руководителя (причины отклонений, узкие места, планы).
Отвечай строго в формате JSON."""

# В шаблоне буквальные {{ }} экранированы — иначе .format() даёт KeyError
USER_PROMPT_TEMPLATE = """Ниже — данные за последние дни (по дням, участкам, видам номенклатуры и количеству). Дата выбранного дня: {date_str}.

{context}

Верни один JSON-объект без markdown-обёртки, со следующей структурой (все строки на русском):
{{
  "productions": {{
    "ЧАЙ": {{
      "assessment": "2–4 предложения: оценка выработки за последний день и выводы по периоду; какие виды номенклатуры идут легче/быстрее, какие сложнее.",
      "trend_summary": "Кратко: тренд по дням по участкам и видам номенклатуры (рост/падение/стабильно).",
      "issues": ["замечания: скачки, аномалии, проблемные участки или виды номенклатуры"],
      "questions": ["вопрос 1 для руководителя?", "вопрос 2?", "вопрос 3?", "вопрос 4?"]
    }},
    "ГРАВИРОВКА": {{ ... то же поля ... }},
    "ЛЮМИНАРК": {{ ... то же поля ... }}
  }},
  "general_notes": "Общие выводы: какие виды операций/номенклатуры стабильны, какие — узкие места (иначе пустая строка)."
}}
Если по производству нет данных — в assessment и trend_summary укажи «Нет данных за выбранный период».
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


def _call_llm(context_text: str, target_date: date) -> tuple[Optional[dict], Optional[str], Optional[str], Optional[dict]]:
    """Вызов LLM. Возвращает (данные, None, None, usage) или (None, сообщение, тип_ошибки, None). usage = {prompt_tokens, completion_tokens, total_tokens}."""
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None, "OPENAI_API_KEY не задан", None, None

    try:
        from openai import OpenAI
    except ImportError:
        return None, "Не установлен пакет openai (pip install openai)", None, None

    client = OpenAI(api_key=api_key)
    user_prompt = USER_PROMPT_TEMPLATE.format(
        date_str=target_date.isoformat(),
        context=context_text,
    )

    rate_limit_msg = (
        "Превышен лимит запросов в минуту (Rate Limit). "
        "На бесплатном тарифе OpenAI лимит небольшой. Подождите 1–2 минуты и нажмите «Запустить ИИ-аналитику» снова."
    )

    for attempt in range(2):
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
            usage = None
            if getattr(response, "usage", None):
                u = response.usage
                usage = {
                    "prompt_tokens": getattr(u, "prompt_tokens", None),
                    "completion_tokens": getattr(u, "completion_tokens", None),
                    "total_tokens": getattr(u, "total_tokens", None),
                }
            if data is not None:
                return data, None, None, usage
            return None, "ИИ вернул некорректный ответ. Попробуйте запустить аналитику ещё раз.", None, usage
        except Exception as e:
            err = str(e).strip()
            err_type = type(e).__name__
            if "401" in err or "Incorrect API key" in err or "invalid_api_key" in err.lower():
                return None, "Неверный API-ключ OpenAI. Проверьте OPENAI_API_KEY.", err_type, None
            if "429" in err or "rate" in err.lower() or err_type == "RateLimitError":
                if attempt == 0:
                    time.sleep(28)
                    continue
                return None, rate_limit_msg, err_type, None
            if "503" in err or "timeout" in err.lower():
                return None, "Сервис OpenAI временно недоступен. Попробуйте позже.", err_type, None
            if err_type == "JSONDecodeError" or ("productions" in err and len(err) < 100):
                return None, "Ответ API в неверном формате (возможна обрезка или сбой). Попробуйте ещё раз.", err_type, None
            return None, f"Ошибка OpenAI API: {err[:200]}", err_type, None
    return None, rate_limit_msg, "RateLimitError", None


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
        ai_response, err_msg, debug_type, usage = _call_llm(context_text, target_date)
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
    if usage:
        result["usage"] = usage
    return result
