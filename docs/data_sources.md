# Data sources

Every dataset listed on the challenge's Resources tab, plus GRACE/GRACE-FO (named in
the brief): what it is, how big it is, what the tool uses it for, and how to get only
what we need.

**How to read the sizes.**
- **Per field** is what one analysis downloads when we ask the service for a point or a
  small box.
- **Bulk** is what one standard file holds when you download the whole thing.

Sizes marked *measured* come from our own cache (`data/cache/`). All the others are
approximate and should be checked against the product page before planning around them.

**Status:**
- ✅ in use
- 🟡 next candidate
- ⬜ not planned yet

## The rule that makes everything efficient

The tool answers questions about **one field**, so never download a whole scene, tile
or country when a point or a small box will do. In order of preference:

1. **A point API or point time series** (POWER, SDA, CropScape, AppEEARS,
   ORNL MODIS subsets, data rods). This returns kilobytes in about a second.
2. **A cloud-optimized file read by window** (COGs on a STAC catalog: Landsat,
   Sentinel-2, NAIP). This reads only the pixels around the field, kilobytes to a few
   MB.
3. **A server-side subset** (OPeNDAP, Harmony, the CDS API). The server cuts the box or
   variables; the request may queue.
4. **A whole-file download.** Only for small global layers (GAEZ) or a one-off
   preprocessing step, never during a farmer's request.

After that, the same three habits apply to every source:

- **Cache every raw response** on disk (`backend/app/cache.py`). A field analyzed once
  answers in about a second and still works when a service is down. Failures are never
  cached.
- **Reduce early.** Turn daily or scene data into the few numbers the engine needs
  (monthly means, frost dates, bare months) right after loading.
- **Prefetch the demo fields** before the presentation, so the demo never waits on a
  slow service.

## Datasets in use

| Dataset | What it is | Size | Used for in the tool | How we use it efficiently |
| --- | --- | --- | --- | --- |
| ✅ **NASA POWER** (daily, AG community) | Modeled daily weather at a ~0.5° grid cell: Tmax, Tmin, rain, top-of-atmosphere radiation | **~540 KB per field** for 20 years × 4 variables (*measured*) | Crop water use (Hargreaves ET0), frost dates and frost-free days, heat days, heavy-rain days, decade change, the 3D season view's weather | One point request for all 20 years and only the 4 variables we need; cached; reduced to monthly values at once. No key |
| ✅ **SSURGO** (USDA NRCS, Soil Data Access) | Official field-scale soil survey: organic matter, water-holding capacity, texture, erodibility, slope, drainage, hydrologic group | **~0.3 KB per field** (*measured*); the bulk national database is several GB | Soil water storage for each crop's root depth, erosion susceptibility, soil notes on each strategy | One SQL query to the REST service returns only the dominant component's top horizon. An empty answer means no survey (outside the U.S.); the tool then uses typical loam values and says so. No key |
| ✅ **Cropland Data Layer** (USDA NASS, CropScape) | 30 m crop type per pixel, every year since 2008 (all of the contiguous U.S.) | **~0.2 KB per field-year** (*measured*); the national raster is several GB per year | Pre-fills the farmer's current rotation from the last 6 years | One pixel value per year, requested one at a time: the service is slow (up to 20 s, with timeouts) and fails under parallel requests. Cached; it only pre-fills, so a failure just leaves the rotation for the farmer to enter |
| ✅ **AAFC Annual Crop Inventory** (Agriculture and Agri-Food Canada) | 30 m crop type per pixel, every year since 2009, all of Canada | **~0.2 KB per field-year** (*measured*) | Pre-fills the current rotation for Canadian fields (tried first; answers "NoData" outside Canada) | One `identify` per year over one kept-alive connection: 6 years in ~0.6 s (*measured*). New connections in quick succession get dropped, so no parallel calls. No key; Open Government Licence – Canada |
| ✅ **AAFC Soil Landscape Grids of Canada** (100 m) | Modelled clay, sand, organic carbon and more, for five depth layers | **~1.4 KB per variable per field** (*measured*) | Canadian soil: topsoil texture class, organic matter, water-holding capacity (Saxton & Rawls 2006). No slope, drainage or erodibility: shown as unknown | `getSamples` returns all five depths in one call; we read 3 variables and average 0–15 cm. No key; Open Government Licence – Canada |

## NASA datasets not yet used

| Dataset | What it is | Size | What it would add | How to use it efficiently |
| --- | --- | --- | --- | --- |
| 🟡 **SMAP** | Satellite surface soil moisture (top ~5 cm) and freeze/thaw, every 2–3 days at ~9–36 km | ~tens of MB per global daily file; a point time series is a few KB | Soil-moisture anomalies: is this field drier or wetter than its own normal? Drought evidence for the water score | AppEEARS point request (one time series for the field), cached. Needs a free **Earthdata Login** |
| 🟡 **GPM IMERG** | Satellite rainfall, global, ~0.1°, every 30 min (daily product too) | ~10–30 MB per global daily file; a point series is a few KB to 1 MB | Storm intensity and frequency for the erosion score; checks POWER's rainfall | Daily Final product only, subset to the field's grid cell through OPeNDAP or Giovanni, cached. Earthdata Login |
| 🟡 **Landsat 8/9** (Collection 2, Level 2) | 30 m surface reflectance every ~8 days (two satellites), since the 1980s | ~1 GB per full scene; one band over a field is a few KB | NDVI: actual bare-soil months and crop growth on this field, replacing the calendar estimate | Windowed reads of cloud-optimized files from a STAC catalog (Microsoft Planetary Computer or USGS on AWS), red and NIR bands only, cloud mask from the QA band. A few dozen scenes per year per field |
| 🟡 **MODIS / VIIRS** | 250–1000 m vegetation indices every 8–16 days, since 2000 (MODIS) and 2012 (VIIRS) | ~100+ MB per tile; a point time series is a few KB | A long, gap-free NDVI history: green-up and harvest dates, bare periods over 20+ years | ORNL DAAC "MODIS/VIIRS Land Product Subsets" web service: one JSON time series per point, no tile downloads |
| 🟡 **SRTM** | Elevation, ~30 m (1 arc-second), 60°N–56°S | ~25 MB per 1°×1° tile | Slope, which drives runoff and erosion risk, for fields where SSURGO has none (outside the U.S.) | Read a small window around the field from a cloud-optimized copy (e.g. OpenTopography or Copernicus DEM on AWS) and compute slope from it |
| ⬜ **ECOSTRESS** | Land-surface temperature and evapotranspiration at ~70 m, irregular revisits (from the space station) | ~tens of MB per granule; a field subset is KB | Heat and water-stress hotspots inside a field; checks our estimated crop water use | AppEEARS area request for the field's polygon; expect gaps (irregular overpasses, clouds). Earthdata Login |
| ⬜ **NLDAS / GLDAS** | Modeled weather, soil moisture and ET: NLDAS hourly ~12 km (North America), GLDAS 3-hourly ~25 km (global) | ~few MB per hourly file; a point series via data rods is KB | Root-zone soil moisture and a second climate source to compare with POWER | GES DISC "data rods": one time series per variable per point, no file downloads |
| ⬜ **GEDI** | Laser canopy height and biomass, ~25 m footprints sampled along tracks, 52°N–52°S | ~hundreds of MB to GB per granule | Little for annual crops: footprints are sparse and crops are short. Possible use: shelterbelts or woody field edges | Skip unless a clear use appears; if needed, AppEEARS or a spatially filtered L4A subset |
| ⬜ **GRACE / GRACE-FO** | Total water storage change (groundwater included), ~300 km, monthly since 2002 | One file holds the whole record (~hundreds of MB, approximate) | Regional context: "groundwater here is declining", which argues for less thirsty rotations on irrigated fields | Download the mascon file once in preprocessing, pull the region's monthly series, and ship it as a small table |

## U.S. ground and agricultural data not yet used

| Dataset | What it is | Size | What it would add | How to use it efficiently |
| --- | --- | --- | --- | --- |
| ⬜ **Web Soil Survey** | The map viewer over SSURGO | — | Nothing beyond SSURGO; link to it so farmers can check their own soil map | Use SSURGO's Soil Data Access (already done) |
| ⬜ **STATSGO2** | Generalized soil map, ~1:250,000 | National database ~hundreds of MB | Fallback where SSURGO has gaps | Same Soil Data Access service, different survey area |
| 🟡 **PRISM** | Terrain-aware climate at ~800 m–4 km: daily, monthly and 30-year normals | ~MB per daily U.S. grid at 4 km; normals are a few files | A sharper local climate than POWER's ~50 km cell, especially in hills; frost dates | Download the 30-year normals once (a few files), read the field's pixel; daily data only if needed. Check the terms of use |
| ⬜ **NAIP** | Aerial photos, ~0.6–1 m, every 2–3 years during the growing season | Terabytes per state; ~hundreds of MB per tile | A visual check of the field and its boundary in the demo | Windowed read from the Planetary Computer STAC catalog, a few hundred KB per field |
| ⬜ **NLCD** | Land cover, 30 m, several editions since 2001 | ~1–2 GB per national edition | Confirms the point is cropland before analysis | Read one pixel through the MRLC web services, or a window from a cloud-optimized copy |
| 🟡 **OpenET** | Field-scale evapotranspiration from satellites, western U.S. | KB of JSON per field per year | Real crop water use for the field, compared with our estimate (strong for the Nevada demo) | Its API with a free key and monthly quota: one monthly series per field, cached |
| ⬜ **CoCoRaHS** | Volunteer daily rain and snow gauges | KB per station-year | Ground check of satellite rain near the field | Nearest few stations only, as a validation figure on the project page |
| ⬜ **USGS NWIS** | Groundwater levels, streamflow, water quality at stations | KB per site series | Local groundwater trend for irrigated fields | REST API for the nearest well; show the trend, not raw data |
| 🟡 **NASS QuickStats** | County and state yields, acreage, production | KB of CSV per query | County yield ranges per crop, so income is local and not just a general class | API with a free key; one query per county and crop list, cached for the season |
| ⬜ **USDA AMS Market News** | Commodity prices and demand by market | KB per report | Price trends that update the income score | MARS API with a free key; a few weekly reports, cached |
| ⬜ **Ag Data Commons** | USDA catalog of research datasets | Varies | Crop-specific values (e.g. cover-crop effects, phenology) for the crop table | Search once; copy cited values into `crops.py` with sources |
| ⬜ **LANDFIRE** | Vegetation type, condition and fuels, ~30 m | GBs nationally | Little for cropland | Skip unless a clear use appears |
| 🟡 **FAO GAEZ** | Global crop suitability and yield potential, ~1–10 km | ~tens of MB per global layer | A second opinion on crop suitability, and the main fallback outside the U.S. | Download the few layers for our crops once; read the field's pixel |

## ESA / ECMWF partner data not yet used

| Dataset | What it is | Size | What it would add | How to use it efficiently |
| --- | --- | --- | --- | --- |
| 🟡 **Sentinel-2** | 10–20 m multispectral imagery every ~5 days, global, since 2015 | ~0.6–1 GB per 100 km tile; a field window is KB | Finer and more frequent NDVI than Landsat: bare-soil months, cover-crop establishment | Windowed reads of cloud-optimized files from a STAC catalog (e.g. Earth Search on AWS), red and NIR bands plus the scene classification mask. Pairs well with Landsat |
| ⬜ **ERA5 / ERA5-Land** | Hourly reanalysis weather and soil variables: ~0.25° (ERA5), ~9 km (ERA5-Land) | GBs per global month; a point series is KB–MB | Soil temperature, wind and a third climate source; useful outside the U.S. | The CDS API with a free account; request a point or tiny box and only the variables needed. Requests queue, so preprocess and cache. Check whether the CDS point time-series datasets fit |

## NASA products we can use (checked 2026-11-14)

Found in the AppEEARS product list (`appeears.earthdatacloud.nasa.gov/api/product`, 194
products) and NASA's catalog (CMR). **AppEEARS** returns a time series for a point or a
field polygon as CSV, so we never download whole files. It needs an Earthdata Login and
works as a queue: submit a request, wait, then download (the wait time is not yet
measured). So the app should prepare results for the demo fields in advance and cache
them, not call AppEEARS live during a farmer's request.

| Product (version) | Resolution, time step, period | What it gives | What it changes in the tool | Access |
| --- | --- | --- | --- | --- |
| **HLSL30_VI / HLSS30_VI (2.0)**, Harmonized Landsat + Sentinel-2 | 30 m, every 2–3 days (with clouds), 2013/2015– | NDVI, EVI and more, ready made | **Observed bare-soil months and crop growth on the field itself**: the main Validity upgrade. **In use:** replay (AppEEARS points) and the crop classifier (891 views of tile T18TVR, 2019–2024) | AppEEARS for a few points; for many pixels read the COGs directly with earthaccess + rasterio: a 33 km window in ~2 s per view, all 891 in 7.5 min |
| **MOD13Q1 / MYD13Q1 (6.1)**, MODIS | 250 m, 16-day, 2000– | NDVI, EVI with quality flags | 25 years of greenness: green-up and harvest timing, how bare periods changed | AppEEARS (also ORNL subsets, no login) |
| **MCD12Q2 (6.1)**, MODIS Land Cover Dynamics | 500 m, yearly, 2001– | Dates of green-up, maturity, senescence and dormancy | **Seasonal transitions, ready made** (the brief asks for these); a check on our crop calendars | AppEEARS |
| **VNP22Q2 (2.0)**, VIIRS Land Surface Phenology | 500 m, yearly, 2013– | Same phenology dates from VIIRS | Second source to compare with MCD12Q2 ("compare approaches") | AppEEARS |
| **SPL4SMGP (8)**, SMAP L4 | 9 km, 3-hourly (daily in AppEEARS), 2015– | **Root-zone** and surface soil moisture (modelled with SMAP data) | Dry and wet months against the field's own normal: crop water stress. **Too big for AppEEARS here:** 3-hourly granules, about 31,000 for 11 years at 3 points (2026-11-14) | AppEEARS, but only for short periods |
| **SPL3SMP_E (6)**, SMAP L3 enhanced | 9 km, daily, 2015– | Surface soil moisture as observed | The pure-observation counterpart to SPL4SMGP. **In use** for the replay instead of SPL4SMGP: one granule a day, not eight | AppEEARS |
| **SPL3FTP (4)**, SMAP freeze/thaw | 36 km, daily, 2015– | Frozen or thawed ground | Soil-thaw timing in spring next to POWER frost dates | AppEEARS |
| **ECO_L4T_ESI (2)**, ECOSTRESS | 70 m, irregular overpasses, 2018– | Evaporative Stress Index | **Crop stress at field scale**, when overpasses and clear skies allow | AppEEARS |
| **ECO_L3T_JET (2)**, ECOSTRESS | 70 m, irregular, 2018– | Actual evapotranspiration | Checks our estimated crop water use | AppEEARS |
| **ECO_L2T_LSTE (2)**, ECOSTRESS | 70 m, irregular, 2018– | Land-surface temperature | Heat hotspots in a field | AppEEARS |
| **MOD16A2GF (6.1)**, MODIS ET | 500 m, 8-day, 2000– | Actual evapotranspiration, gap-filled | Long ET record to compare with our crop water use | AppEEARS |
| **GPM_3IMERGDF (V07)**, IMERG Final | 0.1° (~10 km), daily, 1998 – 2025-09-30 | Satellite rainfall | Heavy-rain days for the erosion score, compared with POWER | GES DISC subsetting (not in AppEEARS) |
| **SRTMGL1 (3)** / **NASADEM** | 30 m, static | Elevation → slope | **Fills the Canadian slope gap**, so erosion risk is no longer "unknown" there | AppEEARS |
| **DAYMET (4)**, ORNL DAAC | 1 km, daily, 1950–2025, North America | Temperature, rain, radiation, vapour pressure | Climate 50× finer than POWER's ~50 km cell, for U.S. and Canadian fields | AppEEARS |
| **GLDAS / NLDAS Noah (2.1 / 2.0)** | 25 km / 12 km, monthly, 2000– / 1979– | Modelled soil moisture, ET, runoff | Longer soil-moisture history than SMAP (from 2015) | GES DISC |
| **GRACE/GRACE-FO mascon (RL06.3 v4)** | ~300 km, monthly, 2002– | Total water storage change | Regional groundwater trend for irrigated fields | PO.DAAC download |
| **OPERA DSWx-HLS (1)** | 30 m, 2016– | Surface water extent | Flooded or waterlogged months on a field | Earthdata (not in AppEEARS) |
| **GEDI L4A (2.1)** | 25 m footprints, sampled, 2019–2025 | Biomass | Little for annual crops; skip | ORNL DAAC |

## Accounts and keys

| Needed for | Account | Cost |
| --- | --- | --- |
| SMAP, IMERG, ECOSTRESS, GEDI, NLDAS/GLDAS, AppEEARS | NASA **Earthdata Login** | Free |
| OpenET | OpenET API key | Free tier with monthly quota |
| QuickStats | NASS API key | Free |
| AMS Market News | MARS API key | Free |
| ERA5 | Copernicus CDS account | Free |
| POWER, SSURGO, CropScape, AAFC crop inventory and soil grids, NWIS, ORNL MODIS subsets, Planetary Computer and AWS STAC reads | None | Free |

Keys come from environment variables in a file outside the repo. Never commit them.

## Suggested order for adding data

The order follows what strengthens the judging rubric's Validity and Relevance most
for the least work:

1. **Satellite NDVI** (MODIS subsets first, then Landsat or Sentinel-2). This replaces
   calendar-based bare months with what the satellite actually saw.
2. **SMAP** soil-moisture anomaly. It adds a soil-water signal and needs only an
   Earthdata login.
3. **IMERG** heavy-rain frequency for the erosion score, compared with POWER.
4. **OpenET** for the Nevada demo field, to check our crop water use.
5. **SRTM** slope where SSURGO has none, which makes non-U.S. fields usable.

Record each new source's terms and citation in `README.md`.
