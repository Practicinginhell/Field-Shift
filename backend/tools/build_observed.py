"""Turn AppEEARS CSVs for the demo fields into the JSON files the API serves (offline).

Run from backend/ after `tools.fetch_appeears` (and before `tools/si_flags.py`, which adds
the stress flags and method scores in place):

    python -m tools.build_observed [data/appeears/<task>]

Writes app/observed_data/<field id>.json. Crop names per year come from the crop maps
(AAFC in Canada, else the USDA Cropland Data Layer), through the same cached loaders
the API uses.
"""

import csv
import sys
from pathlib import Path

from app.crops import ACI_TO_CROP, CDL_TO_CROP
from app.models import ObservedField, ObservedMonth, ObservedYear
from app.observed import classify_month, monthly_series, phenology, read_layer
from app.sources import aafc, cdl
from tools.fetch_appeears import FIELDS, OUT, TASK_NAME

YEARS = range(2019, 2025)
DATA_DIR = Path(__file__).resolve().parents[1] / "app" / "observed_data"
SOURCES = [
    "HLS Landsat/Sentinel-2 vegetation indices v2.0 (HLSL30_VI, HLSS30_VI), 30 m, NASA AppEEARS",
    "MODIS Terra vegetation indices MOD13Q1 v6.1, 250 m, 16-day, via NASA AppEEARS",
    "MODIS land cover dynamics MCD12Q2 v6.1 (green-up, peak, dormancy), 500 m",
    "SMAP L3 enhanced surface soil moisture SPL3SMP_E v6 (0–5 cm, morning pass), 9 km",
]


def _files(task_dir: Path, product: str) -> list[tuple[Path, set[str]]]:
    """Every CSV for `product`, each with the ids of the fields it holds at their current
    point. A field moved to a new point is requested again in a task of its own
    (`fetch_appeears --only <id>`); its rows at the old point are ignored."""
    here = {f["id"]: (f["latitude"], f["longitude"]) for f in FIELDS}
    out = []
    for path in sorted(task_dir.glob(f"*-{product}-*results.csv")):
        with path.open(newline="") as f:
            ids = {
                row["ID"]
                for row in csv.DictReader(f)
                if row["ID"] in here
                and abs(float(row["Latitude"]) - here[row["ID"]][0]) < 1e-4
                and abs(float(row["Longitude"]) - here[row["ID"]][1]) < 1e-4
            }
        out.append((path, ids))
    return out


def _layer(
    task_dir: Path, product: str, column: str, quality: str | None = None
) -> tuple[dict[str, list], dict[str, int]]:
    """One layer per field id from every matching CSV, and each field's row count (one
    row per overpass, clear or not)."""
    rows: dict[str, list] = {}
    overpasses: dict[str, int] = {}
    for path, ids in _files(task_dir, product):
        found = read_layer(path, column, quality=quality)
        with path.open(newline="") as f:
            for row in csv.DictReader(f):
                if row["ID"] in ids:
                    overpasses[row["ID"]] = overpasses.get(row["ID"], 0) + 1
        for fid in ids:
            rows.setdefault(fid, []).extend(found.get(fid, []))
    return rows, overpasses


def _crop(lat: float, lon: float, year: int) -> tuple[str | None, str | None]:
    label = aafc.fetch_aci_year(lat, lon, year).category
    if label:
        return ACI_TO_CROP.get(label), label
    label = cdl.fetch_crop_year(lat, lon, year).category
    return CDL_TO_CROP.get(label or ""), label


def _monthly_values(series: dict, start_year: int, end_year: int) -> list[float | None]:
    return [
        series[(y, m)].value if (y, m) in series else None
        for y in range(start_year, end_year + 1)
        for m in range(1, 13)
    ]


def build(task_dir: Path) -> list[ObservedField]:
    hls, total_overpasses = _layer(task_dir, "HLSL30-VI-020", "HLSL30_VI_020_NDVI")
    hls_s, overpasses_s = _layer(task_dir, "HLSS30-VI-020", "HLSS30_VI_020_NDVI")
    for fid, rows in hls_s.items():
        hls.setdefault(fid, []).extend(rows)
        total_overpasses[fid] = total_overpasses.get(fid, 0) + overpasses_s[fid]
    modis_rows, _ = _layer(
        task_dir,
        "MOD13Q1-061",
        "MOD13Q1_061__250m_16_days_NDVI",
        quality="MOD13Q1_061__250m_16_days_VI_Quality_MODLAND",
    )
    smap_rows, _ = _layer(
        task_dir, "SPL3SMP-E-006", "SPL3SMP_E_006_Soil_Moisture_Retrieval_Data_AM_soil_moisture"
    )
    dates = {}
    for path, ids in _files(task_dir, "MCD12Q2-061"):
        dates.update({fid: d for fid, d in phenology(path).items() if fid in ids})

    fields = []
    for f in FIELDS:
        fid, lat, lon = f["id"], f["latitude"], f["longitude"]
        hls_m = monthly_series(hls.get(fid, []))
        modis_m = monthly_series(modis_rows.get(fid, []))
        smap_m = monthly_series(smap_rows.get(fid, []), use_median=False)
        years = []
        for y in YEARS:
            months = []
            for m in range(1, 13):
                if (y, m) in hls_m:
                    ndvi, source, views = hls_m[(y, m)].value, "HLS 30 m", hls_m[(y, m)].count
                elif (y, m) in modis_m:
                    ndvi, source, views = (
                        modis_m[(y, m)].value,
                        "MODIS 250 m",
                        modis_m[(y, m)].count,
                    )
                else:
                    ndvi, source, views = None, None, 0
                months.append(
                    ObservedMonth(
                        month=m,
                        state=classify_month(ndvi, m, southern=lat < 0),
                        ndvi=ndvi,
                        ndvi_source=source,
                        views=views,
                        soil_moisture=smap_m[(y, m)].value if (y, m) in smap_m else None,
                    )
                )
            crop, label = _crop(lat, lon, y)
            g, p, d = dates.get(fid, {}).get(y, (None, None, None))
            years.append(
                ObservedYear(
                    year=y,
                    crop=crop,
                    crop_label=label,
                    greenup=g,
                    peak=p,
                    dormancy=d,
                    months=months,
                )
            )
        clear = len(hls.get(fid, []))
        fields.append(
            ObservedField(
                id=fid,
                latitude=lat,
                longitude=lon,
                years=years,
                clear_view_share=round(clear / max(1, total_overpasses.get(fid, 0)), 3),
                sources=SOURCES,
                series={
                    "modis_ndvi": {
                        "start": "2000-01",
                        "values": _monthly_values(modis_m, 2000, 2025),
                    },
                    "smap_surface": {
                        "start": "2015-01",
                        "values": _monthly_values(smap_m, 2015, 2025),
                    },
                },
            )
        )
    return fields


def main() -> int:
    task_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT / TASK_NAME
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for field in build(task_dir):
        if not any(m.ndvi is not None for y in field.years for m in y.months):
            print(f"{field.id}: no satellite data in {task_dir}, skipped")
            continue
        path = DATA_DIR / f"{field.id}.json"
        path.write_text(field.model_dump_json(indent=1))
        print(f"{field.id}: wrote {path.name} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
