"""Ranking for place search: relevance, distance, population and recent picks.

Pure functions with no Flask or network use, so they are easy to test alone.
"""

import re
import unicodedata
from math import asin, cos, log1p, radians, sin, sqrt
from typing import Any


def _distance_km(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    latitude_delta = radians(latitude_b - latitude_a)
    longitude_delta = radians(longitude_b - longitude_a)
    value = (
        sin(latitude_delta / 2) ** 2
        + cos(radians(latitude_a))
        * cos(radians(latitude_b))
        * sin(longitude_delta / 2) ** 2
    )
    return 6371 * 2 * asin(sqrt(value))


SEARCH_WEIGHTS = {
    "relevance": 0.55,
    "proximity": 0.15,
    "popularity": 0.20,
    "affinity": 0.10,
}


def fold(text: str) -> str:
    """Case- and accent-insensitive form, so "sao paulo" matches "São Paulo"."""
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _relevance_score(name: str, query: str) -> float:
    normalized_name = fold(name)
    normalized_query = fold(query)
    if normalized_name == normalized_query:
        return 1.0
    if normalized_name.startswith(normalized_query):
        return 0.95
    if any(part.startswith(normalized_query) for part in normalized_name.split()):
        return 0.75
    if normalized_query in normalized_name:
        return 0.35
    return 0.0


def _proximity_score(distance_km: float) -> float:
    return 1 / (1 + distance_km / 250)


def _popularity_score(population: float, maximum_population: float) -> float:
    if maximum_population <= 0:
        return 0.0
    return log1p(population) / log1p(maximum_population)


def _search_score(
    result: dict[str, Any],
    query: str,
    distance: float,
    maximum_population: float,
    affinity: set[str],
) -> float:
    affinity_score = 1.0 if fold(result["name"]) in affinity else 0.0
    return (
        SEARCH_WEIGHTS["relevance"] * _relevance_score(result["name"], query)
        + SEARCH_WEIGHTS["proximity"] * _proximity_score(distance)
        + SEARCH_WEIGHTS["popularity"]
        * _popularity_score(result["population"], maximum_population)
        + SEARCH_WEIGHTS["affinity"] * affinity_score
    )


def _matches_qualifier(result: dict[str, Any], qualifier: str) -> bool:
    """True when a part after a comma ("Paris, Texas", "Paris, FR") names the
    place's region or country: its two-letter country code, or the start of a
    word there ("tex" matches Texas, but "us" does not match Russia)."""
    if qualifier == fold(result["country_code"]):
        return True
    return re.search(rf"(?:^|[\s,]){re.escape(qualifier)}", fold(result["context"])) is not None


def rank_search_results(
    results: list[dict[str, Any]],
    query: str,
    qualifiers: list[str],
    latitude: float,
    longitude: float,
    affinity: set[str],
    limit: int,
) -> list[dict[str, Any]]:
    """Best matches first, with duplicates removed and a distance on each.

    Qualifiers narrow the list to the places that match all of them, unless none do
    (then they are ignored rather than returning nothing). Places with the same name
    and region are kept once. The cached input is never modified.
    """
    if qualifiers:
        results = [
            r for r in results if all(_matches_qualifier(r, q) for q in qualifiers)
        ] or results
    maximum_population = max((r["population"] for r in results), default=0)
    scored = []
    for result in results:
        distance = _distance_km(latitude, longitude, result["latitude"], result["longitude"])
        score = _search_score(result, query, distance, maximum_population, affinity)
        scored.append((score, distance, result))
    scored.sort(key=lambda item: item[0], reverse=True)
    ranked, seen = [], set()
    for _, distance, result in scored:
        key = (fold(result["name"]), fold(result["context"]))
        if key in seen:
            continue
        seen.add(key)
        ranked.append({**result, "distance_km": round(distance)})
        if len(ranked) == limit:
            break
    return ranked
