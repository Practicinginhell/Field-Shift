"""Training data for the crop classifier: HLS 30 m greenness curves, labelled by AAFC's
Annual Crop Inventory (offline step).

A 33 km window of HLS tile T18TVR, south of Ottawa (eastern Ontario farmland), 2019–2024:

1. Labels: AAFC's crop map for each year, exported on the HLS 30 m grid. Only pixels in
   the middle of a uniform 5×5 block are kept (field interiors: HLS geolocation is good
   to about one pixel, so field edges would mix crops). Up to 800 pixels per crop and
   year, chosen at random.
2. Greenness: every HLS Landsat (L30) and Sentinel-2 (S30) view of the window, NDVI with
   clouds, cloud edges and shadows removed (Fmask bits 1–3), read from NASA's cloud with
   the Earthdata login.
3. One row per pixel and year: the median NDVI in each of 36 ten-day bins (NaN where no
   clear view).

The demo field (backend/tools/fetch_appeears.py, "ottawa") and 2 km around it are kept
out of the training rows and saved separately, so its predictions are honest.

AAFC's map is itself a classifier's output (AAFC reports about 85–90% accuracy in
Ontario): the model learns to reproduce it from greenness alone.

    cd backend && PYTHONPATH=. ~/miniconda3/envs/nasa-si/bin/python tools/crop_samples.py

Writes data/crops/samples.npz (gitignored). Needs EARTHDATA_USERNAME/PASSWORD (.env,
read literally, never printed).
"""

import io
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import earthaccess
import numpy as np
import rasterio
import requests
from rasterio.transform import rowcol
from rasterio.warp import transform as warp
from rasterio.windows import Window
from scipy.ndimage import maximum_filter, minimum_filter

from app.envfile import load_env_file

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "crops"
TILE = "T18TVR"
CRS = "EPSG:32618"
TILE_ORIGIN = (399960.0, 5100000.0)  # HLS tile T18TVR upper-left corner, 30 m pixels
WINDOW = Window(col_off=700, row_off=2560, width=1100, height=1100)
YEARS = range(2019, 2025)
BINS = 36  # ten-day bins, Jan 1 → Dec 31
PER_CLASS = 800
DEMO = (45.22, -75.8)  # the Ottawa example field
DEMO_EXCLUDE_PX = 67  # 2 km at 30 m

# AAFC Annual Crop Inventory codes (app/sources/aafc.py ACI_CLASSES) → classifier classes.
# Unspecified "Wheat" (140) and "Cereals" (132) are left out: they can't be told apart.
CLASSES = {
    "corn": [147],
    "soybean": [158],
    "winter_wheat": [145],
    "spring_cereal": [133, 136, 146],  # barley, oats, spring wheat
    "hay_pasture": [122],
}
ACI_EXPORT = (
    "https://agriculture.canada.ca/imagery-images/rest/services/"
    "annual_crop_inventory/{year}/ImageServer/exportImage"
)
CLOUD_BITS = 0b1110  # Fmask bit 1 cloud, 2 adjacent to cloud/shadow, 3 cloud shadow


def window_bounds() -> tuple[float, float, float, float]:
    x0 = TILE_ORIGIN[0] + WINDOW.col_off * 30
    y1 = TILE_ORIGIN[1] - WINDOW.row_off * 30
    return x0, y1 - WINDOW.height * 30, x0 + WINDOW.width * 30, y1


def aci_labels(year: int) -> np.ndarray:
    """AAFC's crop map for `year` on the window's 30 m grid (class codes)."""
    x0, y0, x1, y1 = window_bounds()
    params = (
        f"bbox={x0},{y0},{x1},{y1}&bboxSR=32618&imageSR=32618"
        f"&size={WINDOW.width},{WINDOW.height}&format=tiff&pixelType=U8"
        "&interpolation=RSP_NearestNeighbor&f=image"
    )
    r = requests.get(f"{ACI_EXPORT.format(year=year)}?{params}", timeout=60)
    r.raise_for_status()
    data = r.content
    with rasterio.MemoryFile(io.BytesIO(data)) as mem, mem.open() as src:
        labels = src.read(1)
    if labels.shape != (WINDOW.height, WINDOW.width):
        raise ValueError(f"AAFC export came back as {labels.shape}")
    return labels


def demo_pixel() -> tuple[int, int]:
    xs, ys = warp("EPSG:4326", CRS, [DEMO[1]], [DEMO[0]])
    transform = rasterio.transform.from_origin(*TILE_ORIGIN, 30, 30)
    r, c = rowcol(transform, xs[0], ys[0])
    r, c = r - WINDOW.row_off, c - WINDOW.col_off
    if not (0 <= r < WINDOW.height and 0 <= c < WINDOW.width):
        raise ValueError(f"demo field outside the window: {(r, c)}")
    return int(r), int(c)


def sample_pixels(rng: np.random.Generator) -> dict[str, np.ndarray]:
    """Field-interior pixels per year and class, away from the demo field."""
    dr, dc = demo_pixel()
    rows, cols, years, labels = [], [], [], []
    code_to_class = {code: i for i, codes in enumerate(CLASSES.values()) for code in codes}
    for year in YEARS:
        aci = aci_labels(year)
        uniform = minimum_filter(aci, size=5) == maximum_filter(aci, size=5)
        cls = np.vectorize(lambda v: code_to_class.get(int(v), -1))(aci)
        rr, cc = np.indices(aci.shape)
        far = np.maximum(abs(rr - dr), abs(cc - dc)) > DEMO_EXCLUDE_PX
        counts = []
        for i in range(len(CLASSES)):
            idx = np.flatnonzero(uniform & far & (cls == i))
            pick = rng.choice(idx, size=min(PER_CLASS, idx.size), replace=False)
            rows.append(pick // aci.shape[1])
            cols.append(pick % aci.shape[1])
            years.append(np.full(pick.size, year))
            labels.append(np.full(pick.size, i))
            counts.append(pick.size)
        demo_code = int(aci[dr, dc])
        print(
            f"{year}: {dict(zip(CLASSES, counts, strict=True))}; "
            f"demo field mapped as code {demo_code}"
        )
    return {
        "row": np.concatenate(rows),
        "col": np.concatenate(cols),
        "year": np.concatenate(years),
        "label": np.concatenate(labels),
    }


def granules() -> list[tuple[str, str, str]]:
    """(date, NDVI url, Fmask url) of every HLS L30/S30 VI granule on the tile, 2019–2024."""
    out = []
    for short_name in ("HLSL30_VI", "HLSS30_VI"):
        found = earthaccess.search_data(
            short_name=short_name,
            temporal=(f"{YEARS[0]}-01-01", f"{YEARS[-1]}-12-31"),
            bounding_box=(DEMO[1] - 0.05, DEMO[0] - 0.05, DEMO[1] + 0.05, DEMO[0] + 0.05),
        )
        for g in found:
            name = g["umm"]["GranuleUR"]
            if f".{TILE}." not in name:
                continue
            links = g.data_links()
            ndvi = [u for u in links if u.endswith(".NDVI.tif")]
            fmask = [u for u in links if u.endswith(".Fmask.tif")]  # named HLS.*, not HLS-VI.*
            if ndvi and fmask:
                # name: HLS-VI.L30.T18TVR.2023010T155104.v2.0 → year 2023, day 010
                stamp = name.split(".")[3]
                out.append((stamp[:7], ndvi[0], fmask[0]))
    return sorted(out)


def read_window(fs, url: str) -> np.ndarray:
    for attempt in range(3):
        try:
            with fs.open(url, block_size=256 * 1024, cache_type="blockcache") as f:
                with rasterio.open(f) as src:
                    return src.read(1, window=WINDOW, boundless=True, fill_value=-19999)
        except Exception:  # transient HTTP errors from the archive
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    raise AssertionError("unreachable")


def main() -> None:
    load_env_file(ROOT / ".env")
    earthaccess.login(strategy="environment")
    fs = earthaccess.get_fsspec_https_session()
    rng = np.random.default_rng(0)
    OUT.mkdir(parents=True, exist_ok=True)

    samples = sample_pixels(rng)
    dr, dc = demo_pixel()
    found = granules()
    print(f"{len(found)} HLS granules on {TILE}")

    n = samples["row"].size
    by_year = {y: np.flatnonzero(samples["year"] == y) for y in YEARS}
    obs: list[list[tuple[int, float]]] = [[] for _ in range(n)]
    demo_obs: dict[int, list[tuple[int, float]]] = {y: [] for y in YEARS}

    def fetch(item: tuple[str, str, str]):
        stamp, ndvi_url, fmask_url = item
        try:
            return stamp, read_window(fs, ndvi_url), read_window(fs, fmask_url)
        except Exception as exc:  # noqa: BLE001 - one bad view must not end an hour's run
            print(f"  skipped {stamp}: {type(exc).__name__}", flush=True)
            return stamp, None, None

    t0, done, skipped = time.time(), 0, 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for stamp, ndvi, fmask in pool.map(fetch, found):
            done += 1
            if ndvi is None:
                skipped += 1
                continue
            year, doy = int(stamp[:4]), int(stamp[4:7])
            b = min(BINS - 1, (doy - 1) // 10)
            clear = (ndvi != -19999) & ((fmask.astype(np.int32) & CLOUD_BITS) == 0)
            idx = by_year.get(year)
            if idx is not None:
                r, c = samples["row"][idx], samples["col"][idx]
                ok = clear[r, c]
                for i, v in zip(idx[ok], ndvi[r[ok], c[ok]] * 1e-4, strict=True):
                    obs[i].append((b, float(v)))
                if clear[dr, dc]:
                    demo_obs[year].append((b, float(ndvi[dr, dc]) * 1e-4))
            if done % 50 == 0:
                print(f"  {done}/{len(found)} granules, {time.time() - t0:.0f}s", flush=True)

    def binned(points: list[tuple[int, float]]) -> np.ndarray:
        row = np.full(BINS, np.nan, dtype=np.float32)
        for b in range(BINS):
            vals = [v for bb, v in points if bb == b and -1 <= v <= 1]
            if vals:
                row[b] = np.median(vals)
        return row

    X = np.stack([binned(p) for p in obs])
    demo_X = np.stack([binned(demo_obs[y]) for y in YEARS])
    np.savez_compressed(
        OUT / "samples.npz",
        X=X,
        **samples,
        classes=np.array(list(CLASSES)),
        demo_X=demo_X,
        demo_years=np.array(list(YEARS)),
    )
    clear_share = np.isfinite(X).mean()
    print(
        f"wrote {n} rows; {clear_share:.0%} of ten-day bins had a clear view; "
        f"{skipped} of {len(found)} views skipped"
    )


if __name__ == "__main__":
    main()
