"""Soil properties at a point from USDA NRCS SSURGO, via Soil Data Access.

Source: Soil Survey Staff, NRCS, USDA. Soil Survey Geographic (SSURGO) Database,
https://sdmdataaccess.sc.egov.usda.gov/ . U.S. only: elsewhere this returns `None`.
We read the dominant soil component of the map unit: its top horizon for the soil
properties shown, and every horizon's water-holding for the water stored to root depth.
"""

from dataclasses import dataclass

import httpx2

from app.cache import cached_json

API_URL = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"

_QUERY = """
SELECT mu.mukey, mu.muname, c.cokey, c.compname, c.comppct_r, c.slope_r, c.hydgrp,
  c.drainagecl, ch.hzdept_r, ch.hzdepb_r, ch.om_r, ch.awc_r, ch.claytotal_r,
  ch.sandtotal_r, ch.kwfact
FROM mapunit mu
JOIN component c ON c.mukey = mu.mukey
JOIN chorizon ch ON ch.cokey = c.cokey
WHERE mu.mukey IN (
  SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point({lon} {lat})')
)
ORDER BY c.comppct_r DESC, c.cokey, ch.hzdept_r ASC
"""


@dataclass(frozen=True)
class SoilInfo:
    map_unit: str
    component: str
    component_percent: float | None
    slope_percent: float | None
    hydrologic_group: str | None
    drainage_class: str | None
    organic_matter_percent: float | None
    available_water_cm_per_cm: float | None
    clay_percent: float | None
    sand_percent: float | None
    erodibility_k: float | None
    horizons: tuple[tuple[float, float, float], ...] = ()
    """(top cm, bottom cm, available water cm/cm) of each layer with a value, top
    down. Empty when the source has only the top layer (the Canadian soil maps)."""
    dataset: str = "USDA NRCS SSURGO"
    url: str = "https://websoilsurvey.nrcs.usda.gov/app/"
    period: str = "current survey"
    place: str = "soil map unit at the field point"


def _num(value: str | None) -> float | None:
    if value in (None, ""):
        return None
    return float(value)


def parse_sda(payload: dict) -> SoilInfo | None:
    """Turn a Soil Data Access JSON+COLUMNNAME response into `SoilInfo`, or `None`."""
    table = payload.get("Table") or []
    if len(table) < 2:
        return None
    rows = [dict(zip(table[0], r, strict=True)) for r in table[1:]]
    row = rows[0]
    layers = [r for r in rows if r.get("cokey") == row.get("cokey")]
    return SoilInfo(
        map_unit=row["muname"],
        component=row["compname"],
        component_percent=_num(row["comppct_r"]),
        slope_percent=_num(row["slope_r"]),
        hydrologic_group=row["hydgrp"] or None,
        drainage_class=row["drainagecl"] or None,
        organic_matter_percent=_num(row["om_r"]),
        available_water_cm_per_cm=_num(row["awc_r"]),
        clay_percent=_num(row["claytotal_r"]),
        sand_percent=_num(row["sandtotal_r"]),
        erodibility_k=_num(row["kwfact"]),
        horizons=tuple(
            (float(r["hzdept_r"]), float(r["hzdepb_r"]), float(r["awc_r"]))
            for r in layers
            if r["awc_r"] not in (None, "") and r["hzdepb_r"] not in (None, "")
        ),
    )


def fetch_soil(lat: float, lon: float) -> SoilInfo | None:
    """Download (or read from cache) the dominant soil at a point. `None` if not mapped."""
    # "layers": the query returns every horizon (older cache entries hold only the top one).
    key = {"lat": round(lat, 5), "lon": round(lon, 5), "layers": True}

    def download() -> dict:
        query = _QUERY.format(lat=key["lat"], lon=key["lon"])
        response = httpx2.post(
            API_URL, json={"query": query, "format": "JSON+COLUMNNAME"}, timeout=30
        )
        response.raise_for_status()
        # An empty result comes back as an empty body, not as JSON.
        return response.json() if response.content.strip() else {}

    return parse_sda(cached_json("ssurgo", key, download))
