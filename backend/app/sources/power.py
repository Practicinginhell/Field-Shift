"""NASA POWER daily agroclimatology for one point.

Source: NASA Langley Research Center POWER Project, https://power.larc.nasa.gov/
(daily point API, AG community). Values are for a grid cell of about 0.5° x 0.625°,
so they describe the area around a field, not the field itself.
"""

from dataclasses import dataclass
from datetime import date

import httpx2

from app.cache import cached_json

API_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
HOME_URL = "https://power.larc.nasa.gov/"
PARAMETERS = ("T2M_MAX", "T2M_MIN", "PRECTOTCORR", "TOA_SW_DWN")
FILL_VALUE = -999.0


@dataclass(frozen=True)
class DailyClimate:
    """Daily series for one point. Missing days are `None`."""

    dates: list[date]
    tmax_c: list[float | None]
    tmin_c: list[float | None]
    precip_mm: list[float | None]
    toa_radiation_mj: list[float | None]
    latitude: float
    longitude: float


def parse_power(payload: dict) -> DailyClimate:
    """Turn a POWER JSON response into a `DailyClimate`, masking fill values."""
    params = payload["properties"]["parameter"]
    fill = payload.get("header", {}).get("fill_value", FILL_VALUE)
    keys = sorted(params["T2M_MAX"])

    def series(name: str) -> list[float | None]:
        values = params[name]
        return [None if values[k] is None or values[k] == fill else float(values[k]) for k in keys]

    lon, lat = payload["geometry"]["coordinates"][:2]
    return DailyClimate(
        dates=[date(int(k[:4]), int(k[4:6]), int(k[6:])) for k in keys],
        tmax_c=series("T2M_MAX"),
        tmin_c=series("T2M_MIN"),
        precip_mm=series("PRECTOTCORR"),
        toa_radiation_mj=series("TOA_SW_DWN"),
        latitude=float(lat),
        longitude=float(lon),
    )


def fetch_power(lat: float, lon: float, start_year: int, end_year: int) -> DailyClimate:
    """Download (or read from cache) daily POWER data for whole years."""
    key = {"lat": round(lat, 2), "lon": round(lon, 2), "start": start_year, "end": end_year}

    def download() -> dict:
        response = httpx2.get(
            API_URL,
            params={
                "parameters": ",".join(PARAMETERS),
                "community": "AG",
                "latitude": key["lat"],
                "longitude": key["lon"],
                "start": f"{start_year}0101",
                "end": f"{end_year}1231",
                "format": "JSON",
            },
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    return parse_power(cached_json("power", key, download))
