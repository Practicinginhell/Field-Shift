from pathlib import Path

import pytest

from app.observed import (
    agreed_direction,
    classify_month,
    monthly_series,
    phenology,
    read_layer,
)

FIXTURES = Path(__file__).parent / "fixtures"


def hls_2020():
    landsat = read_layer(FIXTURES / "appeears_hlsl30_ottawa_2020.csv", "HLSL30_VI_020_NDVI")
    sentinel = read_layer(FIXTURES / "appeears_hlss30_ottawa_2020.csv", "HLSS30_VI_020_NDVI")
    return landsat["ottawa"] + sentinel["ottawa"]


def test_read_layer_drops_fill_values_and_keeps_dates():
    rows = read_layer(FIXTURES / "appeears_hlss30_ottawa_2020.csv", "HLSS30_VI_020_NDVI")

    values = [v for _, v in rows["ottawa"]]
    assert values and all(-1 <= v <= 1 for v in values)  # -19999 fills are gone
    assert rows["ottawa"][0][0].year == 2020


def test_read_layer_skips_modis_values_flagged_unusable():
    rows = read_layer(
        FIXTURES / "appeears_mod13q1_ottawa_2020.csv",
        "MOD13Q1_061__250m_16_days_NDVI",
        quality="MOD13Q1_061__250m_16_days_VI_Quality_MODLAND",
    )

    assert 0 < len(rows["ottawa"]) <= 23


def test_monthly_median_follows_the_ottawa_season():
    months = monthly_series(hls_2020())

    assert months[(2020, 7)].value == pytest.approx(0.81, abs=0.02)  # full canopy
    assert months[(2020, 8)].value < 0.45  # spring wheat harvested
    assert months[(2020, 10)].value > 0.6  # green again after harvest
    assert months[(2020, 7)].count >= 2


@pytest.mark.parametrize(
    ("ndvi", "month", "expected"),
    [
        (0.81, 7, "green"),
        (0.40, 6, "partial"),
        (0.20, 5, "bare"),
        (-0.05, 1, "snow"),  # below zero in winter: almost always snow
        (-0.05, 7, "bare"),  # never snow in July (northern hemisphere)
        (None, 3, "no_view"),
    ],
)
def test_classify_month(ndvi, month, expected):
    assert classify_month(ndvi, month, southern=False) == expected


def test_snow_months_flip_in_the_southern_hemisphere():
    assert classify_month(-0.05, 7, southern=True) == "snow"
    assert classify_month(-0.05, 1, southern=True) == "bare"


def test_phenology_dates_from_mcd12q2():
    dates = phenology(FIXTURES / "appeears_mcd12q2_ottawa.csv")["ottawa"]

    assert dates[2020] == ("2020-05-10", "2020-07-27", "2020-11-11")
    assert dates[2019][0] == "2019-05-12"


def test_find_observed_returns_the_nearby_demo_field_only(tmp_path):
    from app.models import ObservedField, ObservedMonth, ObservedYear
    from app.observed import find_observed

    month = ObservedMonth(
        month=1, state="snow", ndvi=-0.05, ndvi_source="HLS 30 m", views=2, soil_moisture=None
    )
    field = ObservedField(
        id="ottawa",
        latitude=45.22,
        longitude=-75.8,
        years=[
            ObservedYear(
                year=2020,
                crop=None,
                crop_label=None,
                greenup=None,
                peak=None,
                dormancy=None,
                months=[month],
            )
        ],
        clear_view_share=0.44,
        sources=["test"],
        series={"modis_ndvi": {"start": "2000-01", "values": [0.1]}},
    )
    (tmp_path / "ottawa.json").write_text(field.model_dump_json())

    near = find_observed(45.221, -75.801, data_dir=tmp_path)  # ~140 m away
    far = find_observed(45.30, -75.80, data_dir=tmp_path)  # ~9 km away

    assert near is not None and near.id == "ottawa"
    assert near.series == {}  # the SI input series stays offline, not sent to the page
    assert far is None


def test_find_observed_keeps_the_crop_classifier_results(tmp_path):
    """tools/train_crop_model.py writes plain JSON keys; the API must serve them."""
    import json

    from app.observed import find_observed

    month = {"month": 7, "state": "green", "ndvi": 0.8, "ndvi_source": "HLS 30 m", "views": 3}
    field = {
        "id": "ottawa",
        "latitude": 45.22,
        "longitude": -75.8,
        "clear_view_share": 0.44,
        "sources": [],
        "years": [
            {
                "year": 2021,
                "crop": "corn",
                "crop_label": "Corn for grain",
                "greenup": None,
                "peak": None,
                "dormancy": None,
                "months": [{**month, "soil_moisture": None}],
                "model_crop": "corn",
                "model_crop_label": "Corn",
                "model_confidence": 0.93,
                "model_agrees": True,
            }
        ],
        "crop_model": {
            "chosen": "XGBoost",
            "classes": ["Corn", "Soybeans"],
            "methods": [
                {"name": "XGBoost", "accuracy": 0.9, "macro_f1": 0.88, "per_class_f1": [0.9, 0.86]}
            ],
            "n_train": 100,
            "n_test": 40,
            "test_note": "new years, new places",
            "telling_days": [201, 211],
        },
    }
    (tmp_path / "ottawa.json").write_text(json.dumps(field))

    found = find_observed(45.22, -75.8, data_dir=tmp_path)

    assert found is not None
    assert found.years[0].model_crop == "corn" and found.years[0].model_agrees is True
    assert found.crop_model is not None and found.crop_model.chosen == "XGBoost"


def test_interpolate_fills_gaps_linearly_and_edges_with_the_nearest_value():
    from app.observed import interpolate

    assert interpolate([None, 1.0, None, 3.0, None]) == [1.0, 1.0, 2.0, 3.0, 3.0]


def test_field_average_band_uses_only_earlier_years_of_the_same_month():
    from app.observed import field_average_band

    # Four years of a monthly series where July (index 6) is 0.6, 0.7, 0.8, 0.9.
    values = [0.0] * 48
    for year, v in enumerate((0.6, 0.7, 0.8, 0.9)):
        values[year * 12 + 6] = v
    band = field_average_band(values, start=36)  # forecast year 4 from years 1–3

    mean, low, high = band[6]
    assert mean == pytest.approx(0.7)  # 0.9 (the target year) is not used
    assert low < 0.7 < high


def test_score_reports_error_and_band_coverage():
    from app.observed import score

    mae, coverage = score([(0.5, 0.4, 0.3, 0.6), (0.9, 0.5, 0.4, 0.6)])

    assert mae == pytest.approx(0.25)
    assert coverage == 0.5


def _year(year, states, flags_in=(), **extra):
    from app.models import ObservedMonth, ObservedYear, StressFlag

    low = StressFlag(
        variable="ndvi",
        direction="low",
        observed=0.4,
        expected_low=0.6,
        expected_high=0.9,
        methods=["TimesFM 2.5"],
    )
    months = [
        ObservedMonth(
            month=i + 1,
            state=s,
            ndvi=None if s == "no_view" else 0.2,
            ndvi_source=None if s == "no_view" else "HLS 30 m",
            views=0 if s == "no_view" else 1,
            soil_moisture=None,
            flags=[low] if i + 1 in flags_in else [],
        )
        for i, s in enumerate(states)
    ]
    return ObservedYear(
        year=year,
        crop="corn",
        crop_label="Corn for grain",
        greenup=None,
        peak=None,
        dormancy=None,
        months=months,
        **extra,
    )


def test_satellite_evidence_counts_bare_months_in_heavy_rain_and_flags_disagreements():
    from app.models import ObservedField
    from app.observed import satellite_evidence

    # Jan–Apr bare, May no view, Jun–Dec green; heavy rain in April and May only.
    states = ["bare"] * 4 + ["no_view"] + ["green"] * 7
    field = ObservedField(
        id="ottawa",
        latitude=45.22,
        longitude=-75.8,
        years=[
            _year(2021, states, flags_in={7}),
            _year(
                2022,
                states,
                model_crop="soybean",
                model_crop_label="Soybeans",
                model_confidence=0.8,
                model_agrees=False,
            ),
        ],
        clear_view_share=0.4,
        sources=[],
    )
    heavy = [0.0, 0.0, 0.0, 0.5, 0.6] + [0.0] * 7

    evidence, review = satellite_evidence(field, heavy)

    bare = evidence[0]
    assert bare.support == "field-level"
    assert bare.value == "8 of 22 months seen bare, 2 of them in heavy-rain months"
    assert bare.period == "2021–2022"
    assert evidence[1].value == "Jul 2021"
    assert any("2022" in r and "Soybeans" in r and "Corn for grain" in r for r in review)
    assert any("Jul 2021" in r for r in review)


def test_satellite_evidence_without_flags_or_disagreements_adds_no_review():
    from app.models import ObservedField
    from app.observed import satellite_evidence

    field = ObservedField(
        id="x",
        latitude=0,
        longitude=0,
        years=[_year(2021, ["green"] * 12)],
        clear_view_share=1,
        sources=[],
    )

    evidence, review = satellite_evidence(field, [0.0] * 12)

    assert [e.value for e in evidence] == [
        "0 of 12 months seen bare, 0 of them in heavy-rain months"
    ]
    assert review == []


def test_a_month_is_unusual_only_when_both_methods_agree_on_the_direction():
    assert agreed_direction({"TimesFM 2.5": "low", "Field average": "low"}, 2) == "low"
    assert agreed_direction({"TimesFM 2.5": "high", "Field average": "high"}, 2) == "high"
    assert agreed_direction({"Field average": "low"}, 2) is None  # one method only
    assert agreed_direction({"TimesFM 2.5": "low"}, 2) is None
    assert agreed_direction({"TimesFM 2.5": "low", "Field average": "high"}, 2) is None
    assert agreed_direction({}, 2) is None
