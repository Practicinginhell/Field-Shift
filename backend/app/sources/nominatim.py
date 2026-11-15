"""Geocode a town, postal code, or place name to coordinates using OpenStreetMap Nominatim.

Uses explicit submit-time search only (no autocomplete on keystrokes), sends a clear
application User-Agent, and caches normalized responses locally via `app.cache`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import httpx2

from app.cache import cached_json

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "FieldShift/0.1 (Space Apps Ottawa 2026)"


@dataclass(frozen=True)
class LocateMatch:
    latitude: float
    longitude: float
    display_name: str


def parse_search(payload: object) -> LocateMatch | None:
    """Validate and extract the top bounded geographic match from a Nominatim payload."""
    if not isinstance(payload, list) or not payload:
        return None
    item = payload[0]
    if not isinstance(item, dict):
        return None
    try:
        lat = float(item["lat"])
        lon = float(item["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (
        math.isfinite(lat)
        and math.isfinite(lon)
        and -90.0 <= lat <= 90.0
        and -180.0 <= lon <= 180.0
    ):
        return None
    name = item.get("display_name")
    if not isinstance(name, str) or not name.strip():
        return None
    return LocateMatch(latitude=lat, longitude=lon, display_name=name.strip())


def search_place(query: str) -> LocateMatch | None:
    """Resolve a place query via Nominatim search, caching normalized results on disk."""
    clean = " ".join(query.strip().split())
    if len(clean) < 2:
        return None

    def _download() -> object:
        response = httpx2.get(
            NOMINATIM_URL,
            params={"q": clean, "format": "jsonv2", "limit": 1},
            headers={"User-Agent": USER_AGENT},
            timeout=8.0,
        )
        response.raise_for_status()
        return response.json()

    payload = cached_json("locate", {"q": clean.lower()}, _download)
    return parse_search(payload)
