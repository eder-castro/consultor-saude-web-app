"""Extract only unambiguous numeric text records without an AI request."""

import re
from datetime import datetime, timedelta
from unicodedata import normalize
from uuid import uuid4
from zoneinfo import ZoneInfo

ENTRY = re.compile(
    r"(?P<label>peso|hidrata[çc][aã]o|[aá]gua|sono|dormi)\s*"
    r"(?:d[eo]\s+)?"
    r"(?P<when>anteontem|ontem|hoje)?\s*"
    r"(?:foi|chegou\s+a|totalizou|deu|:|=)?\s*"
    r"(?P<amount>\d{1,4}(?:[.,]\d{1,2})?)\s*"
    r"(?P<unit>kg|quilos?|litros?|ml|l|horas?|h|minutos?|min)?(?=\W|$)",
    re.IGNORECASE,
)
SEPARATORS = re.compile(r"[\s,;.!?]+|(?:\s+e\s+)", re.IGNORECASE)

GOAL = re.compile(
    r"\b(?:"
    r"(?:bati|batemos|atingi|atingimos|alcancei|alcancamos|cumpri|cumprimos)"
    r"\s+(?:a\s+|minha\s+)?meta\s+(?:hidrica|de\s+(?:agua|hidratacao))"
    r"|meta\s+(?:hidrica|de\s+(?:agua|hidratacao))\s+"
    r"(?:foi\s+|ja\s+)?"
    r"(?:batida|atingida|cumprida|alcancada)"
    r")\b",
)
GOAL_NEGATION = re.compile(
    r"\b(?:nao|ainda|quase|falta|faltou|faltam|faltando|se|quando|talvez|"
    r"vou|pretendo|queria|preciso|nao\s+sei)\b",
)
WATER_VOLUME = re.compile(r"\b(\d{1,5}(?:[.,]\d{1,2})?)\s*(ml|l|litros?)\b")
TOTAL_VOLUME = re.compile(
    r"\b(?:total(?:\s+(?:de|do\s+dia|foi))?|totalizei|totalizou|"
    r"ao\s+todo|fechei\s+(?:o\s+)?dia\s+com|"
    r"bebi\s+ao\s+todo|consumi\s+ao\s+todo|foram)\s*[:=]?\s*"
    r"(\d{1,5}(?:[.,]\d{1,2})?)\s*(ml|l|litros?)\b",
)
DATE_TOKEN = re.compile(r"\b(?:hoje|ontem|anteontem|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4})\b")


def hydration_goal_record(text: str, today: datetime | None = None) -> dict | None:
    """Recognize an affirmative, unambiguous claim about the day's water total."""
    plain = "".join(
        char for char in normalize("NFD", text.lower()) if not 0x300 <= ord(char) <= 0x36F
    ).strip()
    if not GOAL.search(plain) or GOAL_NEGATION.search(plain) or "?" in plain:
        return None
    dates = DATE_TOKEN.findall(plain)
    if len(dates) > 1:
        return None
    reference = today or datetime.now(ZoneInfo("America/Sao_Paulo"))
    selected = reference.date()
    if dates:
        token = dates[0]
        if token in {"hoje", "ontem", "anteontem"}:
            selected -= timedelta(days={"hoje": 0, "ontem": 1, "anteontem": 2}[token])
        else:
            try:
                selected = datetime.strptime(token, "%Y-%m-%d" if "-" in token else "%d/%m/%Y").date()
            except ValueError:
                return None
    volume_matches = WATER_VOLUME.findall(plain)
    explicit_total = TOTAL_VOLUME.findall(plain)
    if len(volume_matches) > 1:
        return None
    milliliters = 2500
    if explicit_total:
        if len(explicit_total) != 1 or len(volume_matches) != 1:
            return None
        amount, unit = explicit_total[0]
        milliliters = round(float(amount.replace(",", ".")) * (1 if unit == "ml" else 1000))
        if not 1 <= milliliters <= 15000:
            return None
    elif volume_matches:
        amount, unit = volume_matches[0]
        stated = round(float(amount.replace(",", ".")) * (1 if unit == "ml" else 1000))
        if not 1 <= stated <= 15000:
            return None
        if stated >= 2500:
            milliliters = stated
    return {
        "evento_tipo": "hidratacao",
        "data": selected.isoformat(),
        "horario": reference.strftime("%H:%M"),
        "itens": [{
            "id": str(uuid4()),
            "item": "Total diário de água",
            "quantidade_estimada": f"{milliliters} ml",
            "total_diario": True,
            "confirmado": True,
        }],
    }


def hydration_goal_is_pending(text: str) -> bool:
    plain = "".join(
        char for char in normalize("NFD", text.lower()) if not 0x300 <= ord(char) <= 0x36F
    )
    goal = GOAL.search(plain)
    if not goal:
        return False
    before = plain[max(0, goal.start() - 30):goal.start()]
    negated = bool(re.search(r"\b(?:nao|ainda|quase|falta|faltam|faltou|se|quando)\b", before))
    return negated


def simple_text_records(text: str, today: datetime | None = None) -> dict | None:
    """Return a reviewable payload only if every word belongs to a supported entry."""
    goal = hydration_goal_record(text, today)
    if goal:
        plain = "".join(
            char for char in normalize("NFD", text.lower()) if not 0x300 <= ord(char) <= 0x36F
        )
        without_goal = GOAL.sub("", plain)
        without_goal = TOTAL_VOLUME.sub("", without_goal)
        without_goal = DATE_TOKEN.sub("", without_goal)
        without_goal = re.sub(r"\b(?:em|no|na|dia|do|de|ja|eu|minha)\b", "", without_goal)
        if not re.sub(r"[\s.,;:!?=\-]+", "", without_goal):
            return {"grupos": [goal]}
    normalized = re.sub(r"(?<=[A-Za-z])\.(?=[A-Za-z])", " ", text.strip())
    water = re.fullmatch(
        r"bebi\s+(\d{1,4}(?:[.,]\d{1,2})?)\s*(ml|l|litros?)\s+de\s+[aá]gua"
        r"(?:\s+(hoje|ontem|anteontem))?",
        normalized,
        re.IGNORECASE,
    )
    if water:
        normalized = f"Água {water[3] or ''} {water[1]} {water[2]}"
    reference = (today or datetime.now(ZoneInfo("America/Sao_Paulo"))).date()
    groups = []
    position = 0
    for match in ENTRY.finditer(normalized):
        if match.start() != position and SEPARATORS.sub("", normalized[position:match.start()]):
            return None
        label = match["label"].lower()
        amount = float(match["amount"].replace(",", "."))
        unit = (match["unit"] or "").lower()
        if label == "peso":
            if unit not in {"", "kg", "quilo", "quilos"} or not 1 <= amount <= 500:
                return None
            event_type, item, quantity = "peso", "Peso", f"{match['amount']} kg"
        elif label in {"sono", "dormi"}:
            if unit not in {"h", "hora", "horas", "min", "minuto", "minutos"}:
                return None
            minutes = amount * (60 if unit.startswith("h") else 1)
            if not 1 <= minutes <= 1440:
                return None
            event_type, item, quantity = "sono", "Sono total", f"{minutes:g} min"
        else:
            if unit not in {"ml", "l", "litro", "litros"}:
                return None
            milliliters = amount * (1000 if unit != "ml" else 1)
            if not 1 <= milliliters <= 15000:
                return None
            event_type, item, quantity = "hidratacao", "Água", f"{milliliters:g} ml"
        days_ago = {"hoje": 0, "ontem": 1, "anteontem": 2}.get(
            (match["when"] or "").lower(), 0
        )
        groups.append(
            {
                "evento_tipo": event_type,
                "data": (reference - timedelta(days=days_ago)).isoformat(),
                "horario": (today or datetime.now(ZoneInfo("America/Sao_Paulo"))).strftime("%H:%M"),
                "itens": [
                    {
                        "id": str(uuid4()),
                        "item": item,
                        "quantidade_estimada": quantity,
                        "confirmado": True,
                    }
                ],
            }
        )
        position = match.end()
    if not groups or SEPARATORS.sub("", normalized[position:]):
        return None
    return {"grupos": groups}


def meal_draft_when_ai_unavailable(text: str, today: datetime | None = None) -> dict | None:
    """Preserve a clearly described meal verbatim when the AI cannot analyze it."""
    match = re.fullmatch(
        r"\s*(?:(?P<when>hoje|ontem|anteontem)\s+)?"
        r"(?P<verb>jantei|almocei|comi|tomei\s+caf[eé]\s+da\s+manh[aã]|"
        r"caf[eé]\s+da\s+manh[aã]\s+foi)\s+"
        r"(?P<description>.+?)\s*",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if not match or len(match["description"]) > 200:
        return None
    reference = today or datetime.now(ZoneInfo("America/Sao_Paulo"))
    days_ago = {"ontem": 1, "anteontem": 2}.get((match["when"] or "").lower(), 0)
    return {
        "grupos": [
            {
                "evento_tipo": "alimentacao",
                "data": (reference.date() - timedelta(days=days_ago)).isoformat(),
                "horario": reference.strftime("%H:%M"),
                "itens": [
                    {
                        "id": str(uuid4()),
                        "item": match["description"].strip(),
                        "quantidade_estimada": "não informado",
                        "confirmado": True,
                    }
                ],
            }
        ],
        "resumo": (
            "Análise automática indisponível. Este é apenas o texto que você enviou, "
            "sem estimativa de porções ou orientação. Confira a data, o horário e os itens antes de salvar."
        ),
    }