"""Past crops and soil at a Canadian point from Agriculture and Agri-Food Canada (AAFC).

Sources (Open Government Licence – Canada):
- AAFC Annual Crop Inventory: 30 m crop class per year, 2009 onward.
  https://open.canada.ca/data/en/dataset/ba2645d5-4458-414d-b196-6303ac06c1c9
- AAFC Soil Landscape Grids of Canada: 100 m modelled clay, sand and organic carbon
  for five depth layers (0–5, 5–15, 15–30, 30–60, 60–100 cm).

Both are ArcGIS image services that answer for one point in about 0.1 s. Outside
Canada they answer "NoData", so callers can try them anywhere and fall back. The soil
grids have no slope, drainage class or erodibility: those stay `None` and the app says
they are unknown.
"""

import httpx2

from app.cache import cached_json
from app.sources.cdl import CropYear
from app.sources.ssurgo import SoilInfo

ACI_URL = (
    "https://agriculture.canada.ca/imagery-images/rest/services/"
    "annual_crop_inventory/{year}/ImageServer/identify"
)
SOIL_URL = (
    "https://agriculture.canada.ca/imagery-images/rest/services/"
    "soil_landscape_grids_100m/{variable}/ImageServer/getSamples"
)

# Codes and English labels from AAFC's "Crop classifications" table (CSV on the
# dataset page above), as published on 2026-11-14.
ACI_CLASSES: dict[int, str] = {
    10: "Cloud",
    20: "Water",
    30: "Exposed land/barren",
    34: "Urban/developed",
    35: "Greenhouses",
    50: "Shrubland",
    60: "Forest fire/burnt area",
    80: "Wetland",
    85: "Peatland",
    110: "Grassland",
    120: "Agriculture (undifferentiated)",
    121: "Cropland",
    122: "Pasture/forages",
    130: "Too wet to be seeded",
    131: "Fallow",
    132: "Cereals",
    133: "Barley",
    134: "Other grains",
    135: "Millet",
    136: "Oats",
    137: "Rye",
    138: "Spelt",
    139: "Triticale",
    140: "Wheat",
    141: "Switchgrass",
    142: "Sorghum",
    143: "Quinoa",
    145: "Winter wheat",
    146: "Spring wheat",
    147: "Corn for grain",
    148: "Tobacco",
    149: "Ginseng",
    150: "Oilseeds",
    151: "Borage",
    152: "Camelina",
    153: "Canola/rapeseed",
    154: "Flaxseed",
    155: "Mustard",
    156: "Safflower",
    157: "Sunflower",
    158: "Soybeans",
    159: "Other oilseeds",
    160: "Pulses",
    161: "Other pulses",
    162: "Peas",
    163: "Chickpeas",
    167: "Beans",
    168: "Fababeans",
    174: "Lentils",
    175: "Vegetables",
    176: "Tomatoes",
    177: "Potatoes",
    178: "Sugarbeets",
    179: "Other vegetables",
    180: "Fruits",
    181: "Berries",
    182: "Blueberry",
    183: "Cranberry",
    185: "Other berries",
    188: "Orchards",
    189: "Other fruits",
    190: "Vineyards",
    191: "Hops",
    192: "Sod",
    193: "Herbs",
    194: "Nursery",
    195: "Buckwheat",
    196: "Canaryseed",
    197: "Hemp",
    198: "Vetch",
    199: "Other crops",
    200: "Forest (undifferentiated)",
    210: "Coniferous",
    220: "Broadleaf",
    230: "Mixedwood",
}

ORGANIC_MATTER_PER_CARBON = 1.724  # conventional organic carbon → organic matter factor
TOPSOIL_LAYERS = {5: 5.0, 15: 10.0}  # layer (bottom depth, cm) → thickness (cm): 0–15 cm


def _point(lat: float, lon: float) -> str:
    # The spatial reference must be inside the geometry: a separate `sr` parameter is
    # ignored and the numbers are then read as Web Mercator metres.
    return f'{{"x":{lon},"y":{lat},"spatialReference":{{"wkid":4326}}}}'


# One shared connection. The service drops many *new* TLS connections that arrive in
# quick succession (checked 2026-11-14: 5 of 6 parallel requests timed out, 1 of 6
# sequential new connections did), while requests over one kept-alive connection all
# answered in ~0.1 s. So: reuse this client, call it sequentially, retry once.
_CLIENT = httpx2.Client()


def _get_json(url: str, params: dict, timeout: float) -> dict:
    try:
        response = _CLIENT.get(url, params=params, timeout=timeout)
    except httpx2.TransportError:
        response = _CLIENT.get(url, params=params, timeout=timeout)
    response.raise_for_status()
    payload = response.json()
    if "error" in payload:  # ArcGIS reports errors with HTTP 200
        raise ValueError(f"AAFC service error: {payload['error']}")
    return payload


def parse_aci(payload: dict) -> str | None:
    """Crop class label from an Annual Crop Inventory `identify` answer, or `None`."""
    value = str(payload.get("value", "NoData"))
    if not value.isdigit():  # "NoData" outside Canada
        return None
    code = int(value)
    return ACI_CLASSES.get(code, f"AAFC class {code}")


def fetch_aci_year(lat: float, lon: float, year: int, timeout: float = 10) -> CropYear:
    """One year of the Annual Crop Inventory. Failures give `category=None`, uncached."""
    key = {"lat": round(lat, 5), "lon": round(lon, 5), "year": year}
    params = {
        "geometry": _point(key["lat"], key["lon"]),
        "geometryType": "esriGeometryPoint",
        "returnGeometry": "false",
        "returnCatalogItems": "false",
        "f": "json",
    }

    def download() -> dict:
        return _get_json(ACI_URL.format(year=year), params, timeout)

    try:
        payload = cached_json("aafc_aci", key, download)
    except (httpx2.HTTPError, ValueError):
        return CropYear(year, None)
    return CropYear(year, parse_aci(payload))


def parse_soil_samples(payload: dict) -> dict[int, float]:
    """Map each depth layer's bottom (cm) to its value; empty outside Canada."""
    layers = {}
    for sample in payload.get("samples") or []:
        value = sample.get("value")
        if value in (None, ""):
            continue
        layers[-int(sample["attributes"]["Depth"])] = float(value)
    return layers


def _topsoil(layers: dict[int, float]) -> float | None:
    if not all(depth in layers for depth in TOPSOIL_LAYERS):
        return None
    total = sum(TOPSOIL_LAYERS.values())
    return sum(layers[d] * t for d, t in TOPSOIL_LAYERS.items()) / total


def saxton_rawls_awc(sand_percent: float, clay_percent: float, organic_matter: float) -> float:
    """Plant-available water (cm/cm) from texture and organic matter.

    Saxton, K.E. and Rawls, W.J. (2006). Soil water characteristic estimates by
    texture and organic matter for hydrologic solutions. SSSA Journal 70: 1569–1578.
    Water held at 33 kPa minus water held at 1500 kPa (their equations 1 and 2).
    """
    s, c, om = sand_percent / 100, clay_percent / 100, organic_matter
    t1500 = (
        -0.024 * s
        + 0.487 * c
        + 0.006 * om
        + 0.005 * s * om
        - 0.013 * c * om
        + 0.068 * s * c
        + 0.031
    )
    wilting = t1500 + (0.14 * t1500 - 0.02)
    t33 = (
        -0.251 * s
        + 0.195 * c
        + 0.011 * om
        + 0.006 * s * om
        - 0.027 * c * om
        + 0.452 * s * c
        + 0.299
    )
    field_capacity = t33 + (1.283 * t33**2 - 0.374 * t33 - 0.015)
    return round(field_capacity - wilting, 3)


def texture_class(sand_percent: float, clay_percent: float) -> str:
    """USDA soil texture class (the texture triangle) from sand and clay percent."""
    sand, clay = sand_percent, clay_percent
    silt = 100 - sand - clay
    if silt + 1.5 * clay < 15:
        return "Sand"
    if silt + 2 * clay < 30:
        return "Loamy sand"
    if clay >= 40:
        if sand > 45:
            return "Sandy clay"
        return "Silty clay" if silt >= 40 else "Clay"
    if clay >= 35 and sand > 45:
        return "Sandy clay"
    if clay >= 27:
        if sand <= 20:
            return "Silty clay loam"
        return "Clay loam" if sand <= 45 else "Sandy clay loam"
    if clay >= 20 and sand > 45 and silt < 28:
        return "Sandy clay loam"
    if silt >= 80 and clay < 12:
        return "Silt"
    if silt >= 50:
        return "Silt loam"
    if clay >= 7 and silt >= 28 and sand <= 52:
        return "Loam"
    return "Sandy loam"


def soil_from_layers(
    clay: dict[int, float], sand: dict[int, float], organic_carbon: dict[int, float]
) -> SoilInfo | None:
    """Topsoil (0–15 cm) properties from the grids' depth layers, or `None` if unmapped."""
    clay_top, sand_top = _topsoil(clay), _topsoil(sand)
    if clay_top is None or sand_top is None:
        return None
    carbon_top = _topsoil(organic_carbon)
    organic_matter = None if carbon_top is None else carbon_top * ORGANIC_MATTER_PER_CARBON
    awc = None if organic_matter is None else saxton_rawls_awc(sand_top, clay_top, organic_matter)
    return SoilInfo(
        map_unit="AAFC Soil Landscape Grids of Canada, 100 m",
        component=texture_class(sand_top, clay_top),
        component_percent=None,
        slope_percent=None,
        hydrologic_group=None,
        drainage_class=None,
        organic_matter_percent=None if organic_matter is None else round(organic_matter, 1),
        available_water_cm_per_cm=awc,
        clay_percent=round(clay_top, 1),
        sand_percent=round(sand_top, 1),
        erodibility_k=None,
        dataset="AAFC Soil Landscape Grids of Canada",
        url="https://sis.agr.gc.ca/cansis/nsdb/psm/index.html",
        period="current model release",
        place="100 m modelled grid cell at the field point, topsoil 0–15 cm",
    )


def fetch_soil(lat: float, lon: float, timeout: float = 10) -> SoilInfo | None:
    """Download (or read from cache) topsoil properties at a point. `None` outside Canada."""
    key = {"lat": round(lat, 5), "lon": round(lon, 5)}
    params = {
        "geometry": _point(key["lat"], key["lon"]),
        "geometryType": "esriGeometryPoint",
        "returnFirstValueOnly": "false",
        "f": "json",
    }

    def layers(variable: str) -> dict[int, float]:
        def download() -> dict:
            return _get_json(SOIL_URL.format(variable=variable), params, timeout)

        return parse_soil_samples(cached_json(f"aafc_soil_{variable}", key, download))

    return soil_from_layers(layers("clay"), layers("sand"), layers("soil_organic_carbon"))
