"""Request NASA satellite time series for the demo fields from AppEEARS (offline step).

AppEEARS queues requests (27 minutes for a one-field test on 2026-11-14), so this runs ahead of
time, never during a farmer's request. Raw CSVs land in data/appeears/<task>/
(gitignored); `build_observed.py` turns them into the small files the app ships.

Credentials: EARTHDATA_USERNAME / EARTHDATA_PASSWORD, read literally from the
environment or from the .env file at the repo root. Never printed.

Run from backend/:  python -m tools.fetch_appeears [--only <field id>] [--resume]
(--only requests one field again, e.g. after moving its point; --resume waits for the
tasks already submitted instead of submitting new ones.)
"""

import sys
import time
from pathlib import Path

import httpx2

from app.envfile import load_env_file

API = "https://appeears.earthdatacloud.nasa.gov/api"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "appeears"

# The demo fields (frontend/src/App.tsx PRESETS).
FIELDS = [
    {"id": "iowa", "latitude": 42.38, "longitude": -93.75},
    # Moved 2026-11-15 from (39.47, -118.85), which the CDL maps as woody wetland, to an
    # alfalfa field interior (CDL alfalfa every year 2019–2024).
    {"id": "nevada", "latitude": 39.465, "longitude": -118.865},
    {"id": "ottawa", "latitude": 45.22, "longitude": -75.8},
]
# Three small tasks instead of one large one: a task applies one date range to all its
# layers, and on 2026-11-14 a single request with SMAP L4 (3-hourly granules, ~31,000 of
# its ~39,000) was still 8% through downloading after 1 h 45 min.
REQUESTS = {
    # MODIS since 2000: the long history the SI comparison forecasts from.
    "modis": (
        [
            {"product": "MOD13Q1.061", "layer": "_250m_16_days_NDVI"},
            {"product": "MCD12Q2.061", "layer": "Greenup"},
            {"product": "MCD12Q2.061", "layer": "Peak"},
            {"product": "MCD12Q2.061", "layer": "Dormancy"},
            {"product": "MCD12Q2.061", "layer": "NumCycles"},
        ],
        "01-01-2000",
        "12-31-2025",
    ),
    # HLS 30 m: only the replay years.
    "hls": (
        [
            {"product": "HLSL30_VI.020", "layer": "NDVI"},
            {"product": "HLSS30_VI.020", "layer": "NDVI"},
        ],
        "01-01-2019",
        "12-31-2024",
    ),
    # SMAP L3 enhanced: one granule a day (surface, 0–5 cm), not L4's eight.
    "smap": (
        [{"product": "SPL3SMP_E.006", "layer": "Soil_Moisture_Retrieval_Data_AM_soil_moisture"}],
        "01-01-2015",
        "12-31-2025",
    ),
}
TASK_NAME = "field-shift-demo-fields-v2"


def log(t0: float, msg: str) -> None:
    print(f"[{time.time() - t0:7.1f}s] {msg}", flush=True)


def main() -> int:
    import os

    load_env_file(ROOT / ".env")
    user, password = os.environ.get("EARTHDATA_USERNAME"), os.environ.get("EARTHDATA_PASSWORD")
    if not user or not password:
        print("EARTHDATA_USERNAME / EARTHDATA_PASSWORD are not set", file=sys.stderr)
        return 1
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    fields = [f for f in FIELDS if only in (None, f["id"])]
    prefix = f"{TASK_NAME}-{only}" if only else TASK_NAME
    out = OUT / TASK_NAME  # one folder: tools.build_observed reads every request in it
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    with httpx2.Client(timeout=120, follow_redirects=True) as client:
        r = client.post(f"{API}/login", auth=(user, password), headers={"Content-Length": "0"})
        if r.status_code != 200:
            print(f"login failed: HTTP {r.status_code}", file=sys.stderr)
            return 1
        auth = {"Authorization": f"Bearer {r.json()['token']}"}
        tasks: dict[str, str] = {}
        ids_file = out / (f"task_ids-{only}.txt" if only else "task_ids.txt")
        if "--resume" in sys.argv:  # wait for tasks already submitted, don't resubmit
            tasks = dict(line.split() for line in ids_file.read_text().splitlines())
            log(t0, f"resuming {', '.join(tasks)}")
        for name, (layers, start, end) in REQUESTS.items():
            if name in tasks:
                continue
            task = {
                "task_type": "point",
                "task_name": f"{prefix}-{name}",
                "params": {
                    "dates": [{"startDate": start, "endDate": end}],
                    "layers": layers,
                    "coordinates": fields,
                },
            }
            r = client.post(f"{API}/task", json=task, headers=auth)
            if r.status_code not in (200, 202):
                print(f"submit {name} failed: HTTP {r.status_code} {r.text[:300]}", file=sys.stderr)
                return 1
            tasks[name] = r.json()["task_id"]
            log(t0, f"submitted {name}: task {tasks[name]}")
        ids_file.write_text("".join(f"{n} {t}\n" for n, t in tasks.items()))
        statuses: dict[str, str | None] = dict.fromkeys(tasks)
        while time.time() - t0 < 6 * 3600 and any(
            s not in ("done", "error") for s in statuses.values()
        ):
            for name, task_id in tasks.items():
                if statuses[name] in ("done", "error"):
                    continue
                new = client.get(f"{API}/task/{task_id}", headers=auth).json().get("status")
                if new != statuses[name]:
                    statuses[name] = new
                    log(t0, f"{name}: {new}")
                if new == "done":
                    for f in client.get(f"{API}/bundle/{task_id}", headers=auth).json()["files"]:
                        if f["file_name"].endswith(".csv"):
                            url = f"{API}/bundle/{task_id}/{f['file_id']}"
                            data = client.get(url, headers=auth)
                            (out / Path(f["file_name"]).name).write_bytes(data.content)
                            log(t0, f"downloaded {f['file_name']} ({len(data.content)} bytes)")
            time.sleep(30)
        client.post(f"{API}/logout", headers=auth)
    log(t0, f"finished: {statuses}")
    return 0 if all(s == "done" for s in statuses.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
