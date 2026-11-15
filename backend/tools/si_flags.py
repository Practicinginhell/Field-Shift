"""SI vs statistics: flag unusual months on the demo fields (offline step).

For each year 2019–2024 and each monthly series (MODIS greenness since 2000, SMAP
surface soil moisture since 2015), two methods predict the 12 months from the years
before only:

- **TimesFM 2.5** (Google, Apache-2.0): a pretrained time-series foundation model; its
  10–90% quantile band is the expected range.
- **Field average**: the same calendar month in earlier years; its 10th–90th
  percentile is the expected range.

A month is flagged as unusual only when both methods put it outside their range, on
the same side (`app.observed.agreed_direction`). Both methods are scored on
the same held-out months: mean absolute error and how often the observation fell inside
the band (ideal about 80%). Greenness is only flagged where the season is expected to
be green (expected ≥ 0.3), so snow and bare winters are not called "stress".

Runs in its own environment (torch, timesfm), never in the app:

    cd backend && PYTHONPATH=. ~/miniconda3/envs/nasa-si/bin/python tools/si_flags.py

after `tools.build_observed`. Edits app/observed_data/*.json in place.
"""

import json
from pathlib import Path

import numpy as np
import timesfm

from app.observed import agreed_direction, field_average_band, interpolate, score

DATA_DIR = Path(__file__).resolve().parents[1] / "app" / "observed_data"
YEARS = range(2019, 2025)
SERIES = {
    "modis_ndvi": ("ndvi", 2000),
    "smap_surface": ("soil_moisture", 2015),
}
GROWING_NDVI = 0.3
LABELS = {"ndvi": "greenness (MODIS NDVI)", "soil_moisture": "surface soil moisture (SMAP)"}
TIMESFM = "TimesFM 2.5"
BASELINE = "Field average"


def load_model():
    model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
        "google/timesfm-2.5-200m-pytorch", torch_compile=False
    )
    model.compile(
        timesfm.ForecastConfig(
            max_context=512,
            max_horizon=64,
            normalize_inputs=True,
            use_continuous_quantile_head=True,
            force_flip_invariance=True,
            infer_is_positive=False,
            fix_quantile_crossing=True,
        )
    )
    return model


def timesfm_band(model, values: list[float | None], start: int) -> list[tuple[float, float, float]]:
    context = np.array(interpolate(values[:start]), dtype=np.float32)
    point, quant = model.forecast(horizon=12, inputs=[context])
    # quant[..., 0] is the mean, then the 10th … 90th percentiles.
    return [(float(point[0, m]), float(quant[0, m, 1]), float(quant[0, m, 9])) for m in range(12)]


def main() -> None:
    model = load_model()
    scored: dict[str, dict[str, list]] = {
        TIMESFM: {"ndvi": [], "soil_moisture": []},
        BASELINE: {"ndvi": [], "soil_moisture": []},
    }
    fields = {p: json.loads(p.read_text()) for p in sorted(DATA_DIR.glob("*.json"))}
    for field in fields.values():
        for year in field["years"]:
            for month in year["months"]:
                month["flags"] = []
        for key, (variable, first_year) in SERIES.items():
            values = field.get("series", {}).get(key, {}).get("values") or []
            if not any(v is not None for v in values):
                continue
            for y_idx, year in enumerate(field["years"]):
                start = (year["year"] - first_year) * 12
                history = sum(v is not None for v in values[:start])
                if history < 24 or start + 12 > len(values):
                    continue  # need two years of real (not gap-filled) history
                bands = {
                    TIMESFM: timesfm_band(model, values, start),
                    BASELINE: field_average_band(values, start),
                }
                for m in range(12):
                    observed = values[start + m]
                    if observed is None:
                        continue
                    flagged: dict[str, str] = {}
                    for name, band in bands.items():
                        mid, low, high = band[m]
                        scored[name][variable].append((observed, mid, low, high))
                        if variable == "ndvi" and mid < GROWING_NDVI:
                            continue
                        if observed < low:
                            flagged[name] = "low"
                        elif observed > high:
                            flagged[name] = "high"
                    direction = agreed_direction(flagged, len(bands))
                    if direction is None:
                        continue
                    _, low, high = bands[TIMESFM][m]
                    field["years"][y_idx]["months"][m]["flags"].append(
                        {
                            "variable": variable,
                            "direction": direction,
                            "observed": round(observed, 4),
                            "expected_low": round(low, 4),
                            "expected_high": round(high, 4),
                            "methods": list(bands),
                        }
                    )
        flagged = sum(bool(m["flags"]) for y in field["years"] for m in y["months"])
        print(f"{field['id']}: flagged {flagged} months")

    methods = []
    for name, by_var in scored.items():
        for variable, points in by_var.items():
            if not points:
                continue
            mae, coverage = score(points)
            methods.append(
                {
                    "name": f"{name}, {LABELS[variable]}",
                    "mean_abs_error": mae,
                    "band_coverage": coverage,
                    "note": f"{len(points)} held-out months, 2019–2024, all demo fields",
                }
            )
            print(
                f"{name:<14} {variable:<14} MAE {mae:.4f}  in band {coverage:.0%}  n={len(points)}"
            )
    for path, field in fields.items():
        field["methods"] = methods
        path.write_text(json.dumps(field, indent=1))


if __name__ == "__main__":
    main()
