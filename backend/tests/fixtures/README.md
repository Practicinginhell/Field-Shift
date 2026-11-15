# Test fixtures

Small excerpts of real responses, recorded 2026-11-14. Tests never call the services.

| File | Source | Request | Edits |
| --- | --- | --- | --- |
| `power_daily_iowa_excerpt.json` | NASA POWER daily point API (AG community) | 42.10, -93.95; first 3 days of 2006 | Trimmed to 3 days; `PRECTOTCORR` on 2006-01-02 set to the fill value -999 to test masking |
| `ssurgo_iowa.json` | USDA NRCS Soil Data Access | point 42.10, -93.95 (Dundas silt loam), every horizon (re-recorded 2026-11-15) | kept only the dominant component's rows |
| `ssurgo_empty.json` | USDA NRCS Soil Data Access | point 45.22, -75.80 (Ottawa, outside SSURGO) | none: the service returns an empty body, cached as `{}` |
| `cdl_corn_2023.xml` | USDA NASS CropScape GetCDLValue | 2023, x=129000, y=2130000 (EPSG:5070) | none |
| `aafc_aci_ottawa_2023.json` | AAFC Annual Crop Inventory 2023, `identify` | point 45.22, -75.80 (class 147, corn for grain) | none |
| `aafc_aci_iowa_2023.json` | AAFC Annual Crop Inventory 2023, `identify` | point 42.38, -93.75 (outside Canada: `NoData`) | none |
| `aafc_soil_{clay,sand,soil_organic_carbon}_ottawa.json` | AAFC Soil Landscape Grids 100 m, `getSamples` | point 45.22, -75.80, all five depth layers | none |
| `aafc_soil_clay_iowa.json` | AAFC Soil Landscape Grids 100 m, `getSamples` | point 42.38, -93.75 (outside Canada: empty values) | none |
