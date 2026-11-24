"""Check photographed sleep stages without deriving unobserved measurements."""

import re
from datetime import date
from typing import Literal
from pydantic import BaseModel


class SleepLevels(BaseModel):
    profundo: Literal["baixo", "normal", "alto"] | None = None
    leve: Literal["baixo", "normal", "alto"] | None = None
    rem: Literal["baixo", "normal", "alto"] | None = None
    acordado: Literal["baixo", "normal", "alto"] | None = None

SLEEP_PHASES = {
    "sono_profundo_min": "sono profundo",
    "sono_leve_min": "sono leve",
    "sono_rem_min": "sono REM",
    "acordado_min": "acordado/despertar",
}
EMPTY_VALUES = {"", "não informado", "não informada", "null", "n/a", "-", "—"}


def has_phase(value: str | None) -> bool:
    return value is not None and value.strip().casefold() not in EMPTY_VALUES


def duration_identity(value: str):
    """Allow equivalent total formats without changing the recorded total."""
    text = value.strip().casefold()
    clock = re.fullmatch(r"(\d{1,2}):([0-5]\d)", text)
    hours = re.fullmatch(
        r"(\d+)\s*(?:h(?:rs?)?|horas?)\s*(?:(\d+)\s*(?:m|min|minutos?)?)?", text,
    )
    minutes = re.fullmatch(r"(\d+)\s*(?:m|min|minutos?)?", text)
    if clock:
        total = int(clock[1]) * 60 + int(clock[2])
    elif hours and int(hours[2] or 0) < 60:
        total = int(hours[1]) * 60 + int(hours[2] or 0)
    elif minutes:
        total = int(minutes[1])
    else:
        return text
    return total if total <= 1440 else text


def sleep_sessions(groups) -> list[dict]:
    return [
        {
            "sessao_id": f"sono:{group_index}:{item_index}",
            "data": group.data,
            "horario": group.horario,
            "item": item.item,
            "quantidade_estimada": item.quantidade_estimada,
            "campos_ausentes": [
                field for field in SLEEP_PHASES if not has_phase(getattr(item, field))
            ],
        }
        for group_index, group in enumerate(groups) if group.evento_tipo == "sono"
        for item_index, item in enumerate(group.itens)
    ]


def missing_sleep_phases(groups) -> list[dict]:
    return [session for session in sleep_sessions(groups) if session["campos_ausentes"]]

def sleep_reading_schema() -> dict:
    # A focused table transcription, not another complete health extraction.
    # Stable references avoid losing a valid reading when the model rewrites
    # "Sono total", a date, or an otherwise unspecified time.
    properties = {
        "sessao_id": {"type": "STRING"},
        "total_minutos": {"type": "INTEGER", "nullable": True},
        "data_imagem": {"type": "STRING", "nullable": True},
    }
    for field in SLEEP_PHASES:
        properties[field] = {"type": "STRING", "nullable": True}
    properties["sono_niveis"] = {
        "type": "OBJECT", "nullable": True,
        "properties": {key: {"type": "STRING", "nullable": True, "enum": ["baixo", "normal", "alto"]}
                       for key in ("profundo", "leve", "rem", "acordado")},
    }
    return {
        "type": "OBJECT", "required": ["leituras"],
        "properties": {"leituras": {
            "type": "ARRAY", "items": {
                "type": "OBJECT", "properties": properties,
                "required": list(properties),
            },
        }},
    }

def merge_sleep_readings(groups, response: dict) -> None:
    readings = response.get("leituras")
    if not isinstance(readings, list):
        raise ValueError("Missing sleep table readings")
    by_id = {}
    for reading in readings:
        if not isinstance(reading, dict) or not isinstance(reading.get("sessao_id"), str):
            raise ValueError("Invalid sleep session reference")
        by_id.setdefault(reading["sessao_id"], []).append(reading)
    for missing in sleep_sessions(groups):
        candidates = by_id.get(missing["sessao_id"], [])
        if len(candidates) != 1:
            continue
        candidate = candidates[0]
        # Require a directly transcribed matching total before associating phases.
        total = candidate.get("total_minutos")
        if type(total) is not int or total != duration_identity(missing["quantidade_estimada"]):
            continue
        _, group_index, item_index = missing["sessao_id"].split(":")
        item = groups[int(group_index)].itens[int(item_index)]
        levels = candidate.get("sono_niveis")
        if isinstance(levels, dict):
            # Merge only explicitly transcribed labels; never derive a level.
            prior = item.sono_niveis.model_dump() if item.sono_niveis else {}
            for key in ("profundo", "leve", "rem", "acordado"):
                if not prior.get(key) and levels.get(key) in {"baixo", "normal", "alto"}:
                    prior[key] = levels[key]
            item.sono_niveis = SleepLevels(**prior)
        image_date = candidate.get("data_imagem")
        if isinstance(image_date, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", image_date):
            try:
                date.fromisoformat(image_date)
            except ValueError:
                pass
            else:
                group = groups[int(group_index)]
                group.data = image_date
                group.data_imagem = image_date
        for field in missing["campos_ausentes"]:
            value = candidate.get(field)
            if not isinstance(value, str) or not has_phase(value):
                continue
            duration = duration_identity(value)
            if type(duration) is int:
                setattr(item, field, f"{duration} min")


def merge_missing_sleep_phases(original_groups, reviewed_groups) -> None:
    # Match a unique session, not merely its position in the response. Keep all
    # previous measurements, totals, dates and unrelated records unchanged.
    def identity(group, item):
        return (
            group.data, group.horario, item.item.strip().casefold(),
            duration_identity(item.quantidade_estimada),
        )

    candidates = {}
    originals = {}
    for groups, index in ((reviewed_groups, candidates), (original_groups, originals)):
        for group in groups:
            if group.evento_tipo == "sono":
                for item in group.itens:
                    index.setdefault(identity(group, item), []).append(item)
    for key, items in originals.items():
        matches = candidates.get(key, [])
        if len(items) != 1 or len(matches) != 1:
            continue
        item, reviewed = items[0], matches[0]
        for field in SLEEP_PHASES:
            value = getattr(reviewed, field)
            if not has_phase(getattr(item, field)) and has_phase(value):
                setattr(item, field, value)


def sleep_photo_warnings(groups) -> list[str]:
    missing = missing_sleep_phases(groups)
    if not missing:
        return []
    labels = [
        label for field, label in SLEEP_PHASES.items()
        if any(field in item["campos_ausentes"] for item in missing)
    ]
    return [
        "A leitura da imagem não identificou: " + ", ".join(labels)
        + ". Confira esses campos na imagem e preencha somente se estiverem informados. "
        "Os valores ausentes não foram calculados a partir do total."
    ]
