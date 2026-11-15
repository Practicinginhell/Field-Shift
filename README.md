# Field Shift

NASA Space Apps Challenge 2026, Space Apps Ottawa: "Field Shift: Adapting Farms with NASA Data".

A decision-support tool that helps farmers explore crop-rotation strategies that may
improve soil health and resilience to changing weather and water conditions. It
combines NASA Earth observations with local soil information, crop characteristics and
the farmer's own priorities. It supports farmer judgment and local agricultural
expertise; it does not replace them.

**Status:** working baseline. Pick a field on the map, enter your current rotation
and what matters to you, and the tool compares your rotation with up to three
alternatives. Each option shows why it was suggested, the evidence (with its data
source), possible benefits, what we don't know, and what to check locally. It uses 20
years of NASA POWER climate data for the area, soil and past crops from U.S. and
Canadian government surveys, and, on the three example fields, what NASA satellites
saw there from 2019 to 2024. It runs anywhere in the world; where soil or crop data
is missing, it says so.

## Run it

Requirements: conda (or any Python 3.13+), Node 22+.

```sh
conda create -n nasa-challenge python=3.14
./scripts/setup     # install backend and frontend dependencies
./scripts/dev       # open http://localhost:5173 (API on http://localhost:8000)
./scripts/test      # backend and frontend tests (offline)
./scripts/lint
```

## Layout

| Path | What |
| --- | --- |
| `backend/` | Python API (FastAPI) |
| `frontend/` | Web app (React, TypeScript, Vite, MapLibre GL JS) |
| `scripts/` | Command wrappers |
| `docs/adr/` | Architecture decision records |

## How it works

1. **Climate** (NASA POWER): 20 complete years of daily temperature, rain and
   top-of-atmosphere radiation for the field's grid cell. From these: frost dates and
   the frost-free season, heat days (35 °C or more), heavy-rain days (25 mm or more),
   monthly rain, and reference evapotranspiration (Hargreaves, FAO-56 eq. 52).
2. **Soil:** in the U.S., SSURGO: organic matter, water-holding capacity, slope and
   erodibility of the dominant soil at the point. In Canada, the AAFC Soil Landscape
   Grids (100 m, modelled): topsoil texture and organic matter, with water-holding
   capacity estimated by Saxton & Rawls (2006); slope and erodibility are not
   available there, and the app says so.
3. **Options:** nine common rotations plus "your rotation with a winter cover crop".
   Options that can't work here are ruled out with the reason shown: a season too
   short for a frost-sensitive crop, or too little rain for a crop without irrigation.
4. **Watch the seasons (3D):** your rotation and the three options as small fields
   side by side, played month by month with the field's average weather. Crops grow and are
   harvested on their calendars, rain falls in proportion to the month's real rain,
   and a scoreboard counts water used and bare soil during heavy-rain months.
5. **Scores:** water use, soil health, erosion protection, pest-cycle breaks and
   income, each from 0 to 100, weighted by your priorities. Crop water use is the
   crop's FAO-56 coefficient times the field's own monthly evapotranspiration.
6. **Gross margin:** for each rotation, yield × price minus costs, per acre a year,
   minus the cost of a winter rye cover crop in the years that have one. Iowa and
   Ontario fields use the current published crop budgets and prices; elsewhere, or for
   a crop the budget doesn't cover, the farmer enters their own yield, price and cost,
   which always replace the budget. Costs leave out land, so this compares rotations on
   the same field; it is not a profit forecast.

The tool suggests options to explore. It does not decide: every option lists what to
check with a local advisor.

## Data sources and citations

| Data | Use | Citation and terms |
| --- | --- | --- |
| NASA POWER daily point API (AG community) | Climate features | NASA Langley Research Center (LaRC) POWER Project, https://power.larc.nasa.gov/ . NASA data. |
| USDA NRCS SSURGO via Soil Data Access | Soil at the field | Soil Survey Staff, Natural Resources Conservation Service, USDA. Soil Survey Geographic (SSURGO) Database, https://sdmdataaccess.sc.egov.usda.gov/ . U.S. Government data. |
| USDA NASS Cropland Data Layer (CropScape) | Optional pre-fill of the current rotation | USDA National Agricultural Statistics Service Cropland Data Layer, https://nassgeodata.gmu.edu/CropScape/ . U.S. Government data. |
| AAFC Annual Crop Inventory | Pre-fill of the current rotation in Canada; training labels for the crop classifier (eastern Ontario, 2019–2024) | Agriculture and Agri-Food Canada, Annual Crop Inventory, https://open.canada.ca/data/en/dataset/ba2645d5-4458-414d-b196-6303ac06c1c9 . Contains information licensed under the Open Government Licence – Canada. |
| AAFC Soil Landscape Grids of Canada (100 m) | Soil at the field in Canada | Agriculture and Agri-Food Canada, Canadian Soil Information Service, Soil Landscape Grids of Canada. Contains information licensed under the Open Government Licence – Canada. |
| NASA HLS v2.0 vegetation indices (HLSL30_VI, HLSS30_VI), MODIS MOD13Q1 v6.1 and MCD12Q2 v6.1, SMAP L3 enhanced SPL3SMP_E v6 | Satellite replay of the example fields: monthly greenness, season dates, surface soil moisture; HLS also feeds the crop classifier | NASA LP DAAC and NSIDC DAAC data, retrieved through AppEEARS (appeears.earthdatacloud.nasa.gov) and, for the classifier, read directly from LP DAAC with earthaccess. NASA data. Cite each product's DOI before submitting. |
| XGBoost, scikit-learn, PyTorch, earthaccess, rasterio | Offline: training and testing the crop classifier; reading HLS from NASA's cloud | Apache-2.0 (XGBoost, earthaccess), BSD-3-Clause (scikit-learn, PyTorch, rasterio). |
| Google TimesFM 2.5 (google/timesfm-2.5-200m-pytorch) | Offline: expected range for each month, to flag unusual months | Apache-2.0. Das, A. et al., "A decoder-only foundation model for time-series forecasting", ICML 2024. |
| Saxton & Rawls (2006) | Water-holding capacity from texture (Canada) | Saxton, K.E., Rawls, W.J. (2006). Soil water characteristic estimates by texture and organic matter for hydrologic solutions. Soil Science Society of America Journal 70: 1569–1578. |
| FAO Irrigation and Drainage Paper 56 | Crop water-use coefficients and root depths | Allen, R.G., Pereira, L.S., Raes, D., Smith, M. (1998). Crop evapotranspiration. FAO Irrigation and Drainage Paper 56. FAO, Rome. |
| Iowa State University Ag Decision Maker A1-20 (2026) and 2026 Iowa Farm Custom Rate Survey (A3-10) | Gross margin, Iowa: yields and variable costs (corn, soybeans, alfalfa); cover crop drilling and spraying | Iowa State University Extension and Outreach, https://www.extension.iastate.edu/agdm/crops/pdf/a1-20.pdf and https://www.extension.iastate.edu/agdm/crops/pdf/a3-10.pdf . |
| USDA WASDE (10 Nov 2026) and NASS Agricultural Prices (30 Oct 2026) | Gross margin, Iowa: 2026/27 season-average corn and soybean prices; Iowa alfalfa hay price | USDA Office of the Chief Economist and NASS, https://www.usda.gov/oce/commodity/wasde/wasde1126.pdf , https://esmis.nal.usda.gov/sites/default/release-files/796128/agpr1026.pdf . U.S. Government data. |
| OMAFA Publication 60, Field Crop Budgets (2026) | Gross margin, Ontario: yields and costs before land; cover crop seed and custom rates | Ontario Ministry of Agriculture, Food and Agribusiness, https://www.ontario.ca/page/publication-60-field-crop-budgets . |
| Statistics Canada Table 32-10-0077-01, Farm product prices | Gross margin, Ontario: crop prices (mean of Oct 2025 to Sep 2026) | Statistics Canada, https://doi.org/10.25318/3210007701-eng . Statistics Canada Open Licence. |
| OpenStreetMap | Map tiles | © OpenStreetMap contributors (ODbL); tile usage policy applies, light development use only. |

## Third-party software

Backend: FastAPI, Uvicorn, httpx2, pyproj, pytest, ruff. Frontend: React, Vite,
TypeScript, MapLibre GL JS, three.js, React Three Fiber, drei, Vitest, Testing Library.
