import json
from pathlib import Path

import pytest

from app.crops import ACI_TO_CROP
from app.sources.aafc import (
    parse_aci,
    parse_soil_samples,
    saxton_rawls_awc,
    soil_from_layers,
    texture_class,
)

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_aci_reads_the_crop_class_at_a_canadian_point():
    assert parse_aci(load("aafc_aci_ottawa_2023.json")) == "Corn for grain"


def test_aci_outside_canada_is_none():
    assert parse_aci(load("aafc_aci_iowa_2023.json")) is None


def test_aci_unknown_code_is_named_not_dropped():
    assert parse_aci({"value": "9999"}) == "AAFC class 9999"


def test_aci_labels_map_to_our_crops():
    assert ACI_TO_CROP["Corn for grain"] == "corn"
    assert ACI_TO_CROP["Soybeans"] == "soybean"
    assert ACI_TO_CROP["Spring wheat"] == "spring_wheat"
    assert "Wheat" not in ACI_TO_CROP  # spring or winter unknown: the farmer picks


def test_soil_samples_are_read_by_depth_layer():
    layers = parse_soil_samples(load("aafc_soil_clay_ottawa.json"))

    assert layers[5] == pytest.approx(19.9036, abs=1e-3)  # 0–5 cm
    assert layers[15] == pytest.approx(21.3058, abs=1e-3)  # 5–15 cm
    assert set(layers) == {5, 15, 30, 60, 100}


def test_soil_samples_outside_canada_are_empty():
    assert parse_soil_samples(load("aafc_soil_clay_iowa.json")) == {}


def test_topsoil_is_the_thickness_weighted_0_to_15_cm_mean():
    soil = soil_from_layers(
        clay=parse_soil_samples(load("aafc_soil_clay_ottawa.json")),
        sand=parse_soil_samples(load("aafc_soil_sand_ottawa.json")),
        organic_carbon=parse_soil_samples(load("aafc_soil_soil_organic_carbon_ottawa.json")),
    )

    assert soil is not None
    assert soil.clay_percent == pytest.approx(20.8, abs=0.05)  # (19.90×5 + 21.31×10) / 15
    assert soil.sand_percent == pytest.approx(50.5, abs=0.05)
    assert soil.organic_matter_percent == pytest.approx(3.6, abs=0.05)  # 2.10% carbon × 1.724
    assert soil.component == "Loam"
    assert soil.available_water_cm_per_cm == pytest.approx(0.13, abs=0.005)
    # Not in the Canadian grids: shown as unknown, never guessed.
    assert soil.slope_percent is None
    assert soil.drainage_class is None
    assert soil.erodibility_k is None
    assert "Canada" in soil.dataset
    assert soil.period == "current model release"


def test_no_layers_means_no_soil():
    assert soil_from_layers(clay={}, sand={}, organic_carbon={}) is None


@pytest.mark.parametrize(
    ("sand", "clay", "expected"),
    [(88, 5, 0.05), (40, 20, 0.14), (20, 15, 0.20), (25, 50, 0.12)],
)
def test_saxton_rawls_matches_typical_textures(sand, clay, expected):
    # Saxton & Rawls (2006), at 2.5% organic matter: sand, loam, silt loam, clay.
    assert saxton_rawls_awc(sand, clay, 2.5) == pytest.approx(expected, abs=0.01)


@pytest.mark.parametrize(
    ("sand", "clay", "expected"),
    [
        (92, 3, "Sand"),
        (65, 10, "Sandy loam"),
        (40, 20, "Loam"),
        (20, 15, "Silt loam"),
        (5, 5, "Silt"),
        (30, 33, "Clay loam"),
        (10, 33, "Silty clay loam"),
        (25, 50, "Clay"),
        (5, 45, "Silty clay"),
    ],
)
def test_texture_class_follows_the_usda_triangle(sand, clay, expected):
    assert texture_class(sand, clay) == expected
