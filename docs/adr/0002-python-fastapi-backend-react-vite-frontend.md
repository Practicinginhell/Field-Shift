# ADR-0002: Python (FastAPI) backend, React + Vite + MapLibre frontend

**Status:** accepted
**Date:** 2026-11-14

## Context

The tool combines NASA Earth observations (SMAP, ECOSTRESS, GPM, Landsat, MODIS, NASA
POWER, GRACE, SRTM) with soil and crop data, and shows farmers a comparison of rotation
strategies on an interactive map. Most NASA products ship as HDF5, NetCDF or GeoTIFF
behind Earthdata login. The work has a challenge deadline, and much of the code is
written with AI agents.

## Decision

- **Backend: Python 3.14 with FastAPI**, in `backend/`. NASA data access and processing
  will use the Python geospatial libraries (`earthaccess`, `xarray`, `rasterio`), added
  when the first dataset is connected. Tests: pytest. Lint and format: ruff.
- **Frontend: React + TypeScript built with Vite**, in `frontend/`, with **MapLibre GL
  JS** for the map. Tests: Vitest. Type check: `tsc`.
- The frontend is a client-side app. It calls the backend under `/api`.
- Heavy data work happens ahead of time (prepared files on the analysis grid), so that
  requests only read small files.

## Consequences

**Easier:**

- NASA's own tutorials and tools are in Python, so each dataset has a known path.
- One language covers data preparation, modeling and the API.
- The frontend builds to static files that any host, including the backend, can serve.

**Harder / we accept:**

- Python is slower than a compiled language for custom per-pixel loops. We keep such
  work inside NumPy/GDAL or do it ahead of time.
- Two toolchains (conda/uv and npm) to install and keep working.

## Alternatives considered

- **Rust backend:** rejected. Speed is not the bottleneck (downloads and the C
  libraries are), its HDF5/NetCDF/GDAL crates are wrappers that are harder to set up,
  and it would still need Python for data preparation.
- **C++ backend:** rejected. It has the same speed as Rust and native GDAL access, but
  a slower build setup, weaker web frameworks and memory-safety risk.
- **Next.js frontend:** rejected. Its server features duplicate the FastAPI backend,
  and the map only runs in the browser.
