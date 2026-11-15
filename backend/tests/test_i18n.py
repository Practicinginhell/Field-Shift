import json
from pathlib import Path

from fastapi.testclient import TestClient

from app import i18n, main
from app.models import AnalyzeResponse, ObservedField
from app.sources.ssurgo import parse_sda
from tests.test_api import BODY, ottawa_soil, use_data
from tests.test_observed import _year
from tests.test_sources import load

client = TestClient(main.app)
OBSERVED = Path(main.__file__).parent / "observed_data"


def observed_with_flags(lat, lon):
    states = ["bare"] * 4 + ["green"] * 8
    return ObservedField(
        id="test",
        latitude=lat,
        longitude=lon,
        years=[_year(2021, states, flags_in={5, 6, 7, 8, 9, 10})],
        clear_view_share=0.5,
        sources=[],
    )


def analyze(body, **data):
    return client.post("/api/analyze", json=body).json()


SCENARIOS = [
    # U.S. soil, a satellite record with unusual months, the default corn-soybean
    ({"soil": "iowa", "observed": True}, BODY),
    # Canadian soil (no slope), Ottawa, an alfalfa rotation
    (
        {"canada": True},
        {
            **BODY,
            "latitude": 45.22,
            "longitude": -75.8,
            "current_rotation": [{"crop": "alfalfa"}] * 3 + [{"crop": "corn"}],
        },
    ),
    # No soil at all, irrigated, wheat with a cover crop, a crop ruled out
    (
        {},
        {
            **BODY,
            "latitude": 39.465,
            "longitude": -118.865,
            "irrigated": True,
            "current_rotation": [{"crop": "winter_wheat", "cover": True}, {"crop": "sorghum"}],
            "excluded_crops": ["canola"],
        },
    ),
    # Fallow, field pea, barley, oats: the rarer crops and their risks
    (
        {"soil": "iowa"},
        {
            **BODY,
            "current_rotation": [
                {"crop": "barley"},
                {"crop": "field_pea", "cover": True},
                {"crop": "oats"},
                {"crop": "fallow"},
            ],
            "priorities": {"water": 5, "income": 0, "forage": 5},
        },
    ),
]


def test_french_leaves_no_english_sentence_behind(monkeypatch):
    left = set()
    for data, body in SCENARIOS:
        observed = (
            observed_with_flags(body["latitude"], body["longitude"])
            if data.get("observed")
            else None
        )
        use_data(
            monkeypatch,
            soil=parse_sda(load("ssurgo_iowa.json")) if data.get("soil") else None,
            canada_soil=ottawa_soil() if data.get("canada") else None,
            observed=observed,
        )
        response = AnalyzeResponse.model_validate(analyze(body))
        left |= set(i18n.translate_response(response))
    assert sorted(left) == []


def test_analyze_in_french(monkeypatch):
    use_data(monkeypatch, soil=parse_sda(load("ssurgo_iowa.json")))

    data = client.post("/api/analyze", json={**BODY, "language": "fr"}).json()

    base = data["strategies"][0]
    assert base["name"] == "Maïs – Soya"
    assert base["why"] == ["C'est votre rotation actuelle. Les autres options lui sont comparées."]
    assert data["conditions"]["summary"][0].startswith("De 2006 à 2025, ce secteur a reçu environ")
    assert data["economics"]["basis"].startswith("Les coûts sont les coûts variables")
    assert data["notes"][0].startswith("Cet outil propose des options à explorer.")


def test_english_stays_the_default(monkeypatch):
    use_data(monkeypatch, soil=parse_sda(load("ssurgo_iowa.json")))

    data = client.post("/api/analyze", json=BODY).json()

    assert data["strategies"][0]["name"] == "Corn – Soybean"


def test_crop_names_in_french():
    names = {c["key"]: c["name"] for c in client.get("/api/crops?lang=fr").json()}
    assert names["corn"] == "Maïs-grain"
    assert names["soybean"] == "Soya"
    assert names["winter_wheat"] == "Blé d'automne"


def test_satellite_record_in_french():
    field = ObservedField.model_validate(json.loads((OBSERVED / "ottawa.json").read_text()))
    left = i18n.translate_observed(field)
    assert left == []
    assert field.crop_model.classes[0] == "Maïs"
    assert {y.crop_label for y in field.years} >= {"Soya"}


def test_numbers_and_dates_read_the_french_way():
    text, ok = i18n.fr(
        "The last spring frost is usually around May 7 and the first fall frost around "
        "Oct 17: about 162 frost-free days."
    )
    assert ok
    assert text == (
        "Le dernier gel du printemps survient d'habitude vers le 7 mai et le premier gel "
        "d'automne vers le 17 oct. : environ 162 jours sans gel."
    )
    text, ok = i18n.fr(
        "The last 10 years were 8% drier, with daily highs 0.6 °C warmer, than the 10 years before."
    )
    assert ok
    assert text == (
        "Les 10 dernières années ont été plus sèches de 8 %, avec des maximums quotidiens "
        "plus chauds de 0,6 °C, que les 10 années précédentes."
    )


def test_a_change_and_its_reason_are_two_sentences_both_in_french():
    text, ok = i18n.fr(
        "Keeps your current crops and adds a year of canola with winter rye cover. Suggested "
        "because you care about breaking pest cycles and market suitability, and it scores "
        "better there than your current rotation."
    )
    assert ok
    assert text == (
        "Garde vos cultures actuelles et ajoute une année de canola avec un couvert de seigle "
        "d'automne. Suggérée parce que vous tenez à briser les cycles des ravageurs et de bons "
        "débouchés, et elle fait mieux que votre rotation actuelle sur ces points."
    )


def test_abbreviated_months_and_decimals_read_cleanly():
    text, _ = i18n.fr(
        "About 1 day a year brings heavy rain (25 mm or more), most often in May and Oct."
    )
    assert text.endswith("surtout en mai et oct.")
    value, _ = i18n.fr("organic matter 3.6%, water-holding 0.126 cm/cm", loose=True)
    assert value == "matière organique 3,6 %, réserve en eau 0,126 cm/cm"
    method, _ = i18n.fr("TimesFM 2.5, greenness (MODIS NDVI)", loose=True)
    assert method == "TimesFM 2.5, verdure (MODIS NDVI)"
