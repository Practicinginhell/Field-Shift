"""What NASA satellites saw on a field: monthly greenness, season dates, soil moisture.

Inputs are AppEEARS point CSVs (see `tools/fetch_appeears.py`). This module turns
them into monthly values and month states; `tools/build_observed.py` writes the result
as small JSON files that the API serves for the demo fields.

Harmonization: everything is reduced to the field point and to calendar months.
- Greenness (NDVI): HLS 30 m (Landsat + Sentinel-2) first; MODIS 250 m where HLS had no
  clear view that month. Median of the clear views in the month.
- Season dates: MODIS MCD12Q2 (500 m) green-up, peak and dormancy, one per year.
- Surface soil moisture (0–5 cm): SMAP L3 enhanced (9 km), monthly mean of the morning
  passes. Regional, not field-level.
"""

import csv
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from statistics import median

# Month states. Thresholds are common rules of thumb for NDVI, not calibrated for these
# fields: say so wherever they are shown.
GREEN_NDVI = 0.5  # closed canopy
PARTIAL_NDVI = 0.3  # emerging, senescing, sparse cover
SNOW_NDVI = 0.0  # below zero in a winter month: almost always snow or ice
WINTER_NORTH = {11, 12, 1, 2, 3, 4}
_MODIS_EPOCH = date(1970, 1, 1)  # MCD12Q2 dates are days since 1970-01-01
_MCD_FILL = 32767


def read_layer(
    path: Path, column: str, quality: str | None = None
) -> dict[str, list[tuple[date, float]]]:
    """One layer from an AppEEARS point CSV, per field id, without fill values.

    `quality`: for MODIS, the MODLAND QA column; only "good" (0b00) and "check other
    QA" (0b01) values are kept.
    """
    out: dict[str, list[tuple[date, float]]] = defaultdict(list)
    with path.open(newline="") as f:
        for row in csv.DictReader(f):
            value = float(row[column])
            if not -1.0 <= value <= 1.0 and "NDVI" in column:
                continue  # fill value (-19999 for HLS, -0.3 or -3000 style for MODIS)
            if value <= -9999:
                continue
            if quality and row[quality] not in ("0b00", "0b01"):
                continue
            out[row["ID"]].append((date.fromisoformat(row["Date"][:10]), value))
    return dict(out)


@dataclass(frozen=True)
class MonthValue:
    value: float
    count: int


def monthly_series(points: list[tuple[date, float]], use_median: bool = True) -> dict:
    """(year, month) → MonthValue: the median (or mean) of the values in that month."""
    by_month: dict[tuple[int, int], list[float]] = defaultdict(list)
    for day, value in points:
        by_month[(day.year, day.month)].append(value)
    return {
        key: MonthValue(
            round(median(v) if use_median else sum(v) / len(v), 4),
            len(v),
        )
        for key, v in by_month.items()
    }


def classify_month(ndvi: float | None, month: int, southern: bool) -> str:
    """Month state from its NDVI: green, partial, bare, snow or no_view."""
    if ndvi is None:
        return "no_view"
    winter = month in WINTER_NORTH if not southern else ((month + 5) % 12 + 1) in WINTER_NORTH
    if ndvi < SNOW_NDVI and winter:
        return "snow"
    if ndvi >= GREEN_NDVI:
        return "green"
    if ndvi >= PARTIAL_NDVI:
        return "partial"
    return "bare"


def phenology(path: Path) -> dict[str, dict[int, tuple[str, str, str]]]:
    """Field id → year → (green-up, peak, dormancy) as ISO dates, first cycle only."""

    def iso(raw: str) -> str | None:
        v = float(raw)
        return None if v >= _MCD_FILL else (_MODIS_EPOCH + timedelta(days=int(v))).isoformat()

    out: dict[str, dict[int, tuple[str, str, str]]] = defaultdict(dict)
    with path.open(newline="") as f:
        for row in csv.DictReader(f):
            dates = tuple(iso(row[f"MCD12Q2_061_{k}_0"]) for k in ("Greenup", "Peak", "Dormancy"))
            if all(dates):
                out[row["ID"]][int(row["Date"][:4])] = dates  # type: ignore[assignment]
    return dict(out)


DATA_DIR = Path(__file__).resolve().parent / "observed_data"
MAX_DISTANCE_KM = 2.0


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    # Equirectangular approximation: plenty for "within 2 km".
    from math import cos, radians, sqrt

    x = radians(lon2 - lon1) * cos(radians((lat1 + lat2) / 2))
    y = radians(lat2 - lat1)
    return 6371.0 * sqrt(x * x + y * y)


def find_observed(lat: float, lon: float, data_dir: Path = DATA_DIR):
    """The prepared satellite record of the demo field within 2 km, or `None`.

    Only the example fields have one: AppEEARS takes about half an hour per request,
    so records are prepared offline (`tools/build_observed.py`). The `series` used by
    the offline SI step is dropped here; the page doesn't need it.
    """
    from app.models import ObservedField

    for path in sorted(data_dir.glob("*.json")):
        field = ObservedField.model_validate_json(path.read_text(encoding="utf-8"))
        if _km(lat, lon, field.latitude, field.longitude) <= MAX_DISTANCE_KM:
            return field.model_copy(update={"series": {}})
    return None


# ---- SI vs statistics: shared pieces (stdlib only, so tools/si_flags.py can use them
# from its own environment)


def interpolate(values: list[float | None]) -> list[float]:
    """Fill gaps linearly between known values; leading/trailing gaps take the nearest."""
    known = [i for i, v in enumerate(values) if v is not None]
    if not known:
        return [0.0] * len(values)
    out = []
    for i, v in enumerate(values):
        if v is not None:
            out.append(float(v))
            continue
        before = max((k for k in known if k < i), default=None)
        after = min((k for k in known if k > i), default=None)
        if before is None or after is None:
            out.append(float(values[after if before is None else before]))  # type: ignore[arg-type]
        else:
            a, b = values[before], values[after]
            out.append(a + (b - a) * (i - before) / (after - before))  # type: ignore[operator]
    return out


def agreed_direction(flagged: dict[str, str], methods: int) -> str | None:
    """The direction ("low" or "high") a month is unusual in, or None.

    `flagged` maps each method that put the month outside its expected range to the
    side it fell on. A month counts as unusual only when all `methods` flagged it on
    the same side: one method alone is too often a forecast that drifted, and a farmer
    reads every flag as "something happened here"."""
    sides = set(flagged.values())
    return sides.pop() if len(flagged) == methods and len(sides) == 1 else None


def field_average_band(values: list[float | None], start: int) -> list[tuple[float, float, float]]:
    """The statistical baseline: for each of the 12 months from index `start` (a
    January), the mean and the 10th–90th percentile of the same calendar month in the
    years before. Returns (mean, low, high) per month."""
    from statistics import mean, quantiles

    band = []
    for m in range(12):
        history = [values[i] for i in range(m, start, 12) if values[i] is not None]
        if len(history) < 2:
            v = history[0] if history else 0.0
            band.append((v, v, v))
            continue
        deciles = quantiles(history, n=10, method="inclusive")
        band.append((mean(history), deciles[0], deciles[-1]))
    return band


def score(points: list[tuple[float, float, float, float]]) -> tuple[float, float]:
    """(mean absolute error, share inside the band) for (observed, expected, low, high)."""
    if not points:
        return 0.0, 0.0
    mae = sum(abs(o - e) for o, e, _, _ in points) / len(points)
    inside = sum(lo <= o <= hi for o, _, lo, hi in points) / len(points)
    return round(mae, 4), round(inside, 3)


# ---- What the satellites saw, as evidence for the farmer's current rotation

HEAVY_RAIN_MONTH = 0.3
"""Heavy-rain days (≥ 25 mm) per month, field average, that make it an erosion month.
Same rule as the page's season view (frontend/src/season.ts HEAVY_RAIN_MONTH)."""
_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def satellite_evidence(field, monthly_heavy_rain_days: list[float]):
    """Evidence and review lines for the current rotation, from the field's satellite record.

    `field` is an ObservedField; `monthly_heavy_rain_days` is the climate summary's
    average heavy-rain days per calendar month. Returns (evidence, local_review):
    bare months seen (and how many fell in heavy-rain months), months less green than
    expected, and years where the crop classifier and the crop map disagree.
    """
    from app.models import Evidence

    first, last = field.years[0].year, field.years[-1].year
    period = f"{first}–{last}" if first != last else str(first)
    months = [(y.year, m) for y in field.years for m in y.months]
    seen = [(yr, m) for yr, m in months if m.state != "no_view"]
    bare = [(yr, m) for yr, m in seen if m.state == "bare"]
    in_rain = [m for _, m in bare if monthly_heavy_rain_days[m.month - 1] >= HEAVY_RAIN_MONTH]
    evidence = [
        Evidence(
            dataset="NASA HLS 30 m greenness (Landsat + Sentinel-2, MODIS when cloudy)",
            variable="Months the field was seen bare",
            value=(
                f"{len(bare)} of {len(seen)} months seen bare, "
                f"{len(in_rain)} of them in heavy-rain months"
            ),
            period=period,
            place="the field point (30 m pixel)",
            support="field-level",
            url="https://www.earthdata.nasa.gov/data/projects/hls",
        )
    ]
    low = [
        f"{_SHORT[m.month - 1]} {yr}"
        for yr, m in months
        if any(f.variable == "ndvi" and f.direction == "low" for f in m.flags)
    ]
    review = []
    if low:
        shown = ", ".join(low[:4]) + (f" and {len(low) - 4} more" if len(low) > 4 else "")
        evidence.append(
            Evidence(
                dataset="MODIS greenness, unusual months by TimesFM 2.5 and the field average",
                variable="Months less green than expected",
                value=shown,
                period=period,
                place="250 m MODIS cell at the field",
                support="field-level",
                url="https://lpdaac.usgs.gov/products/mod13q1v061/",
            )
        )
        review.append(
            f"Satellites saw the field less green than expected in {shown}: compare with "
            "what happened (late planting, drought, hail, pests, snow) before trusting the water "
            "scores."
        )
    review.extend(
        f"In {y.year} the crop map says {y.crop_label}, but the field's greenness curve "
        f"reads {y.model_crop_label}: check your crop history for that year."
        for y in field.years
        if y.model_agrees is False
    )
    return evidence, review
