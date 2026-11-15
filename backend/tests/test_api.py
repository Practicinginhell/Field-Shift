from datetime import date

import httpx2
from fastapi.testclient import TestClient

from app import main
from app.sources import aafc
from app.sources.cdl import CropYear
from app.sources.ssurgo import parse_sda
from tests.conftest import synthetic_daily
from tests.test_aafc import load as load_fixture
from tests.test_sources import load

client = TestClient(main.app)
BODY = {
    "latitude": 42.1,
    "longitude": -93.95,
    "current_rotation": [{"crop": "corn"}, {"crop": "soybean"}],
}


def ottawa_soil():
    return aafc.soil_from_layers(
        clay=aafc.parse_soil_samples(load_fixture("aafc_soil_clay_ottawa.json")),
        sand=aafc.parse_soil_samples(load_fixture("aafc_soil_sand_ottawa.json")),
        organic_carbon=aafc.parse_soil_samples(
            load_fixture("aafc_soil_soil_organic_carbon_ottawa.json")
        ),
    )


def use_data(
    monkeypatch, soil=None, soil_error=None, power_error=None, canada_soil=None, observed=None
):
    def fake_power(lat, lon, start, end):
        if power_error:
            raise power_error
        return synthetic_daily(start_year=start, years=end - start + 1)

    def fake_soil(lat, lon):
        if soil_error:
            raise soil_error
        return soil

    monkeypatch.setattr(main.power, "fetch_power", fake_power)
    monkeypatch.setattr(main.ssurgo, "fetch_soil", fake_soil)
    monkeypatch.setattr(main.aafc, "fetch_soil", lambda lat, lon: canada_soil)
    monkeypatch.setattr(main, "find_observed", lambda lat, lon: observed)


def test_analyze_returns_baseline_and_alternatives(monkeypatch):
    use_data(monkeypatch, soil=parse_sda(load("ssurgo_iowa.json")))

    response = client.post("/api/analyze", json=BODY)

    assert response.status_code == 200
    data = response.json()
    assert data["strategies"][0]["is_baseline"]
    assert len(data["strategies"]) >= 3
    assert data["conditions"]["soil"]["component"] == "Dundas"
    assert len(data["conditions"]["monthly_precip_mm"]) == 12


def test_analyze_adds_what_satellites_saw_to_the_current_rotation(monkeypatch):
    from app.models import ObservedField
    from tests.test_observed import _year

    states = ["bare"] * 4 + ["green"] * 8
    observed = ObservedField(
        id="iowa",
        latitude=BODY["latitude"],
        longitude=BODY["longitude"],
        years=[_year(2021, states, flags_in={7})],
        clear_view_share=0.5,
        sources=[],
    )
    use_data(monkeypatch, soil=parse_sda(load("ssurgo_iowa.json")), observed=observed)

    data = client.post("/api/analyze", json=BODY).json()

    baseline, others = data["strategies"][0], data["strategies"][1:]
    variables = [e["variable"] for e in baseline["evidence"]]
    assert "Months the field was seen bare" in variables
    assert "Months less green than expected" in variables
    assert any("Jul 2021" in r for r in baseline["local_review"])
    assert all("Months the field was seen bare" not in str(s["evidence"]) for s in others)


def test_every_evidence_item_links_to_its_source(monkeypatch):
    from app.models import ObservedField
    from tests.test_observed import _year

    states = ["bare"] * 4 + ["green"] * 8
    observed = ObservedField(
        id="iowa",
        latitude=BODY["latitude"],
        longitude=BODY["longitude"],
        years=[_year(2021, states, flags_in={7})],
        clear_view_share=0.5,
        sources=[],
    )
    use_data(monkeypatch, soil=parse_sda(load("ssurgo_iowa.json")), observed=observed)

    data = client.post("/api/analyze", json=BODY).json()

    links = {e["dataset"]: e["url"] for s in data["strategies"] for e in s["evidence"]}
    assert len(links) >= 5  # POWER, POWER + FAO-56, SSURGO, FAO-56, HLS, MODIS
    assert all(url and url.startswith("https://") for url in links.values()), links
    assert links["USDA NRCS SSURGO"] == "https://websoilsurvey.nrcs.usda.gov/app/"


def test_canadian_soil_evidence_links_to_the_soil_landscape_grids(monkeypatch):
    use_data(monkeypatch, soil=None, canada_soil=ottawa_soil())

    data = client.post("/api/analyze", json={**BODY, "latitude": 45.3, "longitude": -75.7}).json()

    soil = [e for e in data["strategies"][0]["evidence"] if e["variable"].startswith("Soil")]
    assert soil[0]["url"] == "https://sis.agr.gc.ca/cansis/nsdb/psm/index.html"


def test_analyze_fails_clearly_when_nasa_power_is_down(monkeypatch):
    use_data(monkeypatch, power_error=httpx2.ConnectError("down"))

    response = client.post("/api/analyze", json=BODY)

    assert response.status_code == 502
    assert "NASA POWER" in response.json()["detail"]


def test_analyze_continues_without_soil_when_ssurgo_fails(monkeypatch):
    use_data(monkeypatch, soil_error=httpx2.ReadTimeout("slow"))

    response = client.post("/api/analyze", json=BODY)

    assert response.status_code == 200
    assert response.json()["conditions"]["soil"] is None
    assert any("soil survey service" in n for n in response.json()["notes"])


def test_no_missing_soil_note_when_canadian_soil_fills_in_for_a_failed_ssurgo(monkeypatch):
    use_data(monkeypatch, soil_error=httpx2.ReadTimeout("slow"), canada_soil=ottawa_soil())

    response = client.post("/api/analyze", json={**BODY, "latitude": 45.22, "longitude": -75.8})

    data = response.json()
    assert data["conditions"]["soil"]["component"] == "Loam"
    assert not any("soil data is missing" in n for n in data["notes"])


def test_analyze_rejects_unknown_crop(monkeypatch):
    use_data(monkeypatch)

    response = client.post("/api/analyze", json={**BODY, "current_rotation": [{"crop": "kale"}]})

    assert response.status_code == 422


def test_crops_lists_the_crop_table():
    keys = [c["key"] for c in client.get("/api/crops").json()]

    assert "corn" in keys and "alfalfa" in keys


def test_crop_history_maps_cdl_classes_and_keeps_failed_years(monkeypatch):
    answers = iter(["Corn", "Soybeans", None, "Corn", "Developed/Open Space", "Soybeans"])
    monkeypatch.setattr(main.aafc, "fetch_aci_year", lambda lat, lon, year: CropYear(year, None))
    monkeypatch.setattr(
        main.cdl, "fetch_crop_year", lambda lat, lon, year: CropYear(year, next(answers))
    )

    data = client.get("/api/crop-history", params={"latitude": 42.1, "longitude": -93.95}).json()

    assert [y["crop"] for y in data["years"]] == ["corn", "soybean", None, "corn", None, "soybean"]
    assert data["years"][2]["cdl_category"] is None


def test_analyze_uses_canadian_soil_where_ssurgo_has_none(monkeypatch):
    use_data(monkeypatch, soil=None, canada_soil=ottawa_soil())

    response = client.post("/api/analyze", json={**BODY, "latitude": 45.22, "longitude": -75.8})

    assert response.status_code == 200
    data = response.json()
    assert data["conditions"]["soil"]["component"] == "Loam"
    evidence = [e["dataset"] for s in data["strategies"] for e in s["evidence"]]
    assert "AAFC Soil Landscape Grids of Canada" in evidence
    gaps = " ".join(g for s in data["strategies"] for g in s["gaps"])
    assert "slope" in gaps.lower()


def test_crop_history_uses_the_canadian_inventory_when_it_answers(monkeypatch):
    labels = ["Soybeans", "Spring wheat", "Corn for grain", "Soybeans", "Wheat", "Soybeans"]
    first = date.today().year - len(labels)
    by_year = {first + i: label for i, label in enumerate(labels)}  # fetched in parallel
    monkeypatch.setattr(
        main.aafc, "fetch_aci_year", lambda lat, lon, year: CropYear(year, by_year[year])
    )

    def no_cdl(lat, lon, year):
        raise AssertionError("the slow U.S. service must not be called for a Canadian field")

    monkeypatch.setattr(main.cdl, "fetch_crop_year", no_cdl)

    data = client.get("/api/crop-history", params={"latitude": 45.22, "longitude": -75.8}).json()

    assert data["source"].startswith("AAFC Annual Crop Inventory")
    assert [y["crop"] for y in data["years"]] == [
        "soybean",
        "spring_wheat",
        "corn",
        "soybean",
        None,
        "soybean",
    ]


def test_observed_says_clearly_when_a_field_has_no_satellite_replay():
    response = client.get("/api/observed", params={"latitude": 0.0, "longitude": 0.0})

    assert response.status_code == 404
    assert "example fields" in response.json()["detail"]
