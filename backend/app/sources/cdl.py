"""Past crops at a point from the USDA NASS Cropland Data Layer (CropScape).

Source: USDA National Agricultural Statistics Service Cropland Data Layer,
https://nassgeodata.gmu.edu/CropScape/ . 30 m, annual, U.S. only. The service is slow
and often times out, so the app uses it only to pre-fill the current rotation, never
on the analysis path. Each year is cached once it succeeds.
"""

import re
from dataclasses import dataclass

import httpx2
from pyproj import Transformer

from app.cache import cached_json

API_URL = "https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue"
_TO_CONUS_ALBERS = Transformer.from_crs("EPSG:4326", "EPSG:5070", always_xy=True)
_RESULT = re.compile(r'value:\s*(\d+),\s*category:\s*"([^"]*)"')


@dataclass(frozen=True)
class CropYear:
    year: int
    category: str | None
    """The CDL class name, e.g. "Corn"; `None` when the lookup failed."""


def parse_cdl(text: str) -> str | None:
    """Return the CDL category name from a GetCDLValue response, or `None`."""
    match = _RESULT.search(text)
    if not match or match.group(1) == "0":
        return None
    return match.group(2)


def fetch_crop_year(lat: float, lon: float, year: int, timeout: float = 30) -> CropYear:
    """Look up one year. A timeout or HTTP error gives `category=None` and is not cached."""
    x, y = _TO_CONUS_ALBERS.transform(lon, lat)
    key = {"lat": round(lat, 5), "lon": round(lon, 5), "year": year}

    def download() -> str:
        response = httpx2.get(API_URL, params={"year": year, "x": x, "y": y}, timeout=timeout)
        response.raise_for_status()
        return response.text

    try:
        text = cached_json("cdl", key, download)
    except httpx2.HTTPError:  # slow or failing service: report the year as unknown
        return CropYear(year, None)
    return CropYear(year, parse_cdl(text))
