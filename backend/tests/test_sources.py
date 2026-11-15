import json
from datetime import date
from pathlib import Path

import pytest

from app import cache
from app.sources.cdl import parse_cdl
from app.sources.power import parse_power
from app.sources.ssurgo import parse_sda

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_power_parse_keeps_dates_values_and_location():
    climate = parse_power(load("power_daily_iowa_excerpt.json"))

    assert climate.dates == [date(2006, 1, 1), date(2006, 1, 2), date(2006, 1, 3)]
    assert (climate.latitude, climate.longitude) == (42.1, -93.95)
    assert all(isinstance(v, float) for v in climate.tmax_c)


def test_power_parse_masks_fill_values_as_missing():
    climate = parse_power(load("power_daily_iowa_excerpt.json"))

    assert climate.precip_mm[1] is None
    assert climate.precip_mm[0] is not None


def test_ssurgo_parse_reads_dominant_component_and_top_horizon():
    soil = parse_sda(load("ssurgo_iowa.json"))

    assert soil is not None
    assert soil.component == "Dundas"
    assert soil.organic_matter_percent == 6.0
    assert soil.available_water_cm_per_cm == 0.23
    assert soil.slope_percent == 1.0
    assert soil.erodibility_k == pytest.approx(0.37)


def test_ssurgo_parse_keeps_every_layer_of_the_dominant_soil():
    cols = ["mukey", "muname", "cokey", "compname", "comppct_r", "slope_r", "hydgrp",
            "drainagecl", "hzdept_r", "hzdepb_r", "om_r", "awc_r", "claytotal_r",
            "sandtotal_r", "kwfact"]  # fmt: skip
    payload = {
        "Table": [
            cols,
            ["1", "Appian fsl", "10", "Appian", "85", "1", "B", "Well", "0", "25", "1", "0.14",
             "10", "60", ".2"],
            ["1", "Appian fsl", "10", "Appian", "85", "1", "B", "Well", "25", "117", "", "0.07",
             "8", "80", ".1"],
            ["1", "Appian fsl", "11", "Other", "15", "1", "B", "Well", "0", "200", "1", "0.2",
             "10", "40", ".2"],
        ]
    }  # fmt: skip

    soil = parse_sda(payload)

    assert soil.available_water_cm_per_cm == 0.14  # the top layer, as shown on the page
    assert soil.horizons == ((0.0, 25.0, 0.14), (25.0, 117.0, 0.07))


def test_ssurgo_parse_returns_none_outside_the_survey():
    assert parse_sda(load("ssurgo_empty.json")) is None


def test_cdl_parse_reads_category():
    text = (FIXTURES / "cdl_corn_2023.xml").read_text(encoding="utf-8")
    assert parse_cdl(text) == "Corn"


def test_cdl_parse_treats_background_value_as_no_data():
    assert parse_cdl('<Result>{x: 1.0, y: 2.0, value: 0, category: "Background"}</Result>') is None


def test_cache_calls_fetch_once_per_key(tmp_path, monkeypatch):
    monkeypatch.setenv("ROTATION_CACHE_DIR", str(tmp_path))
    calls = []

    def fetch():
        calls.append(1)
        return {"value": 1}

    assert cache.cached_json("ns", {"a": 1}, fetch) == {"value": 1}
    assert cache.cached_json("ns", {"a": 1}, fetch) == {"value": 1}
    assert len(calls) == 1


def test_cache_does_not_store_failures(tmp_path, monkeypatch):
    monkeypatch.setenv("ROTATION_CACHE_DIR", str(tmp_path))

    def failing():
        raise TimeoutError("slow service")

    with pytest.raises(TimeoutError):
        cache.cached_json("ns", {"a": 1}, failing)
    assert cache.cached_json("ns", {"a": 1}, lambda: "ok") == "ok"
