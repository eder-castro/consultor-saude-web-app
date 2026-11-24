"""Detect photo food quantities that describe uncertainty without a measure."""

import re
import unicodedata


def has_concrete_portion(quantity: str) -> bool:
    normalized = "".join(
        char for char in unicodedata.normalize("NFD", quantity.casefold())
        if not unicodedata.combining(char)
    )
    return bool(re.search(
        r"\d+(?:[.,/]\d+)?\s*(?:a\s+\d+\s*)?"
        r"(?:g|kg|mg|ml|l|gramas?|quilos?|mililitros?|litros?|"
        r"colheres?|conchas?|xicaras?|copos?|fatias?|unidades?|"
        r"pedacos?|folhas?|rodelas?|cubos?|file(?:s)?|bifes?|"
        r"punhados?|pratos?|tigelas?|pires)\b",
        normalized,
    ))


def food_items_needing_portions(groups) -> list[str]:
    return [
        item.item
        for group in groups if group.evento_tipo == "alimentacao"
        for item in group.itens
        # Truly unavailable measurements must not become invented defaults.
        if item.quantidade_estimada.strip().casefold() != "não informado"
        and not has_concrete_portion(item.quantidade_estimada)
    ]