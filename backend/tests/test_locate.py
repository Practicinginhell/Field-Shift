import httpx2
from fastapi.testclient import TestClient

from app import main
from app.sources import nominatim

client = TestClient(main.app)


def test_parse_nominatim_extracts_bounded_place_or_none():
    parsed = nominatim.parse_search(
        [
            {
                "lat": "42.03078",
                "lon": "-93.63191",
                "display_name": "Ames, Story County, Iowa, United States",
            }
        ]
    )
    assert parsed == nominatim.LocateMatch(
        latitude=42.03078,
        longitude=-93.63191,
        display_name="Ames, Story County, Iowa, United States",
    )
    assert nominatim.parse_search([]) is None
    assert nominatim.parse_search([{"lat": "95.0", "lon": "0", "display_name": "Invalid"}]) is None
    assert nominatim.parse_search([{"lat": "nan", "lon": "0", "display_name": "NaN"}]) is None


def test_search_place_caches_with_identifying_user_agent(monkeypatch, tmp_path):
    monkeypatch.setenv("ROTATION_CACHE_DIR", str(tmp_path))
    calls: list[tuple[str, dict, dict]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            pass

        def json(self):
            return [
                {
                    "lat": "45.4208777",
                    "lon": "-75.6901106",
                    "display_name": "Ottawa, Ontario, Canada",
                }
            ]

    def fake_get(url, *, params=None, headers=None, timeout=None):
        calls.append((url, dict(params or {}), dict(headers or {})))
        return FakeResponse()

    monkeypatch.setattr(nominatim.httpx2, "get", fake_get)

    first = nominatim.search_place("  Ottawa,   ON ")
    second = nominatim.search_place("ottawa, on")

    assert first is not None and first.display_name == "Ottawa, Ontario, Canada"
    assert second == first
    assert len(calls) == 1
    assert calls[0][1]["format"] == "jsonv2"
    assert calls[0][1]["limit"] == 1
    assert "FieldShift" in calls[0][2]["User-Agent"]


def test_api_locate_handles_success_not_found_validation_and_upstream_error(monkeypatch):
    monkeypatch.setattr(
        main.nominatim,
        "search_place",
        lambda q: (
            nominatim.LocateMatch(42.0308, -93.6319, "Ames, Iowa") if "ames" in q.lower() else None
        ),
    )

    ok = client.get("/api/locate", params={"q": "Ames, Iowa"})
    assert ok.status_code == 200
    assert ok.json() == {"latitude": 42.0308, "longitude": -93.6319, "display_name": "Ames, Iowa"}

    missing = client.get("/api/locate", params={"q": "Nowhereville"})
    assert missing.status_code == 404

    short = client.get("/api/locate", params={"q": "a"})
    assert short.status_code == 422

    def fail(_q: str):
        raise httpx2.ConnectError("offline")

    monkeypatch.setattr(main.nominatim, "search_place", fail)
    err = client.get("/api/locate", params={"q": "Ames, Iowa"})
    assert err.status_code == 502
