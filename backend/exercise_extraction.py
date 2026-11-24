"""Preserve provider pace detail without cramming it into the average field."""
import re


def separate_pace_details(value):
    if not isinstance(value, dict):
        return value
    pace = value.get("ritmo_min_km")
    if not isinstance(pace, str) or len(pace) <= 120:
        return value
    result = dict(value)
    # Keep the entire original text for review; never truncate or infer splits.
    extra = value.get("ritmos_parciais")
    result["ritmos_parciais"] = f"{extra}\n{pace}" if isinstance(extra, str) and extra else pace
    mean = re.match(r"^\s*(\d{1,3}:[0-5]\d\s*(?:min\s*)?/\s*km(?:\s*\(m[eé]dia\))?)", pace, re.I)
    result["ritmo_min_km"] = mean.group(1).strip() if mean else None
    return result
