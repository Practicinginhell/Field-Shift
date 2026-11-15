import pytest
from fastapi.testclient import TestClient

from app import economics, main
from app.models import CropNumbers, RotationYear
from app.sources.ssurgo import parse_sda
from tests.test_api import BODY, ottawa_soil, use_data
from tests.test_sources import load

client = TestClient(main.app)


def years(*crops, cover=False):
    return [RotationYear(crop=c, cover=cover) for c in crops]


def iowa_numbers():
    budget = economics.budget_for(42.38, -93.75, us_soil=True)
    assert budget is not None
    return {k: CropNumbers.model_validate(v.model_dump()) for k, v in budget.crops.items()}, budget


def test_budget_follows_the_field_location():
    assert economics.budget_for(42.38, -93.75, us_soil=True).region == "Iowa"
    assert economics.budget_for(45.22, -75.80, us_soil=False).region == "Ontario"
    # Northern New York sits inside Ontario's box, but it has a U.S. soil survey.
    assert economics.budget_for(44.5, -75.5, us_soil=True) is None
    assert economics.budget_for(39.465, -118.865, us_soil=True) is None


def test_corn_soybean_margin_in_iowa_matches_the_published_budget():
    numbers, budget = iowa_numbers()
    # corn 211 bu x $4.60 - $483.60 = $487.00; soybeans 61 bu x $12.10 - $290.21 = $447.89
    margin, missing = economics.rotation_margin(
        years("corn", "soybean"), numbers, budget.cover_crop_cost
    )
    assert missing == []
    assert margin == pytest.approx((487.00 + 447.89) / 2)


def test_a_winter_rye_cover_costs_its_seeding_every_year_it_is_grown():
    numbers, budget = iowa_numbers()
    plain, _ = economics.rotation_margin(years("corn", "soybean"), numbers, budget.cover_crop_cost)
    covered, _ = economics.rotation_margin(
        years("corn", "soybean", cover=True), numbers, budget.cover_crop_cost
    )
    assert covered == pytest.approx(plain - budget.cover_crop_cost)


def test_no_margin_when_a_crop_has_no_numbers_and_the_crop_is_named():
    numbers, budget = iowa_numbers()
    margin, missing = economics.rotation_margin(
        years("corn", "soybean", "canola"), numbers, budget.cover_crop_cost
    )
    assert margin is None
    assert missing == ["Canola"]


def test_no_cover_cost_means_the_cover_crop_is_named_as_missing():
    numbers, _ = iowa_numbers()
    margin, missing = economics.rotation_margin(years("corn", cover=True), numbers, None)
    assert margin is None
    assert missing == ["Winter rye cover"]


def test_analyze_gives_each_rotation_a_margin_in_iowa(monkeypatch):
    use_data(monkeypatch, soil=parse_sda(load("ssurgo_iowa.json")))

    data = client.post("/api/analyze", json=BODY).json()

    assert data["economics"]["region"] == "Iowa"
    assert data["economics"]["currency"] == "USD"
    base = data["strategies"][0]["margin"]
    assert base["per_acre"] == 467
    assert base["vs_current"] == 0
    rye_name = "Corn + rye cover – Soybean + rye cover"
    with_rye = next(s for s in data["strategies"] if s["name"] == rye_name)
    assert with_rye["margin"]["vs_current"] == -42
    shown = {line["crop"] for line in data["economics"]["crops"]}
    assert {"corn", "soybean"} <= shown


def test_the_farmers_own_numbers_replace_the_budget(monkeypatch):
    use_data(monkeypatch, soil=parse_sda(load("ssurgo_iowa.json")))
    body = {
        **BODY,
        "own_numbers": {"corn": {"yield_per_acre": 211, "price": 5.60, "cost_per_acre": 483.60}},
    }

    data = client.post("/api/analyze", json=body).json()

    # $1 a bushel more on 211 bu of corn, every other year: +$105.50 a year
    assert data["strategies"][0]["margin"]["per_acre"] == 573
    corn = next(line for line in data["economics"]["crops"] if line["crop"] == "corn")
    assert corn["price"] == 5.60
    assert corn["own"] is True


def test_ontario_uses_its_budget_and_asks_for_a_hay_price(monkeypatch):
    use_data(monkeypatch, soil=None, canada_soil=ottawa_soil())
    body = {**BODY, "latitude": 45.22, "longitude": -75.80}

    data = client.post("/api/analyze", json=body).json()

    assert data["economics"]["region"] == "Ontario"
    assert data["economics"]["currency"] == "CAD"
    assert data["strategies"][0]["margin"]["per_acre"] is not None
    alfalfa = next(s for s in data["strategies"] if s["name"].startswith("Alfalfa"))
    assert alfalfa["margin"]["per_acre"] is None
    assert alfalfa["margin"]["missing"] == ["Alfalfa"]


def test_elsewhere_the_farmer_enters_every_number(monkeypatch):
    use_data(monkeypatch, soil=parse_sda(load("ssurgo_iowa.json")))
    body = {**BODY, "latitude": 39.465, "longitude": -118.865}

    data = client.post("/api/analyze", json=body).json()

    assert data["economics"]["region"] is None
    assert data["strategies"][0]["margin"]["per_acre"] is None
    assert data["strategies"][0]["margin"]["missing"] == ["Corn (grain)", "Soybean"]
