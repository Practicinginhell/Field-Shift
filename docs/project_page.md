# Field Shift: project page draft

Draft text for the NASA Space Apps project page, written for the judges. Paste each
section into the matching field of the submission form. Before submitting:

- [ ] Check the form's actual field list for 2026 and move the sections to match.
- [ ] Fill in every **[TODO]**: team, links, screenshots, checked impact figures.
- [ ] Re-run the demo fields and update any number marked *(live, 2026-11-14)* if it changed.

---

## High-level summary

Field Shift helps a farmer answer one question: *given 20 years of data about my own
field, which crop rotations are worth considering, and why?* The farmer clicks their
field on a map, confirms the rotation they grow today (pre-filled from satellite crop
maps in the U.S. and Canada), and says what matters most: saving water, adding organic
matter, fixing nitrogen, reducing erosion, breaking pest cycles, forage or market
suitability, and which crops they can't grow or sell. The tool reads NASA POWER climate
data and the local soil map, rules out rotations that can't work there (with the
reason), and compares the current rotation with three alternatives. Every option
comes with its reasons, the evidence behind them, its benefits, what we don't know,
and what to check locally. A 3D view plays the seasons on two fields side by side, so
a farmer can *see* when soil lies bare in heavy-rain months. It supports the farmer's
judgment; it does not replace it.

## The problem

Weather is shifting under farms that plan rotations from habit: what was grown last
year, what the neighbours grow. Changes in rain, heat and frost show up slowly, field
by field, and the data that describes them (satellite climate records, soil surveys,
crop maps) is spread across agencies and formats few farmers have time to learn.
Choosing a rotation is a decision for many seasons: a rotation that leaves soil bare
during the heaviest rains, or that needs more water than falls, costs soil and money
for years.

[TODO: two or three *checked* figures on scale, each with its source. Candidates noted
in `docs/vision.md` are not yet verified.]

## What it does

1. **Your field.** Click the map. The tool reads the field's past six years of crops
   from satellite crop maps (USDA Cropland Data Layer in the U.S., AAFC Annual Crop
   Inventory in Canada) and fills in the current rotation, for the farmer to confirm.
2. **Your field's conditions.** From 20 complete years of NASA POWER daily data
   (2006–2025): rain against evaporation demand by month, frost dates and the
   frost-free season, heavy-rain and heat days, and how the last decade differs from
   the one before. For the Iowa demo field *(live, 2026-11-14)*: 861 mm of rain a year
   against 973 mm of evaporation demand, 174 frost-free days, and the last 10 years
   4% drier and 0.7 °C warmer than the 10 before.
3. **What can't work here, and why.** Hard limits remove options with the reason
   shown: a frost-sensitive crop needing a longer season than the field's median, or,
   without irrigation, a crop whose season rain plus stored soil water covers less
   than 60% of its water use. On a Nevada field without irrigation, 10 rotations are
   ruled out; corn, for example, would get only 23% of the water it uses.
4. **Options compared.** The current rotation plus up to three alternatives, scored on
   the seven goals the brief names and weighted by the farmer's own priorities. Each option shows:
   **why** it was suggested, the **evidence** (dataset, variable, period, place and
   scale for every number), its **benefits**, the **gaps** (what we don't know) and
   **what to check locally**.
5. **Watch the seasons (3D).** The current rotation and one option as two small 3D
   fields, played month by month with the field's average weather: crops grow on their
   calendars, rain falls in proportion to real monthly rain, and a warning appears
   when soil is bare in a heavy-rain month. A scoreboard counts water used and bare
   months in heavy-rain months for each.
6. **Your field, seen from space (example fields).** The same 3D field replays what
   NASA satellites actually saw, month by month, 2019–2024: greenness from HLS
   (Landsat + Sentinel-2, 30 m), season dates from MODIS, soil moisture from SMAP. Months
   that were unusual for the field are flagged (only when both methods below agree), and what the satellites saw (bare
   months in heavy-rain months, less-green months) becomes **field-level evidence on
   the current rotation's card**, with lines for the farmer to check.
   On the Iowa example field (corn–soybean) the satellites saw bare soil in 41 of 72
   months, 18 of them in months with heavy rain; on the Ottawa field, 22 of 72, none
   in heavy-rain months.
7. **Which crop grew here? A trained model.** A classifier trained on 11,732 satellite
   greenness curves from eastern Ontario reads each year's crop from the field's own
   curve, and says when it disagrees with the crop map. On the Ottawa example field
   (left out of training) it agrees with the crop map in all six years, 2019–2024.

[TODO: screenshot of the comparison, the 3D season view, and the replay.]

## How it works

```
NASA POWER daily climate (20 years) ──> climate features ─┐
Soil map (SSURGO in the U.S., AAFC grids in Canada) ──────┼─> rotation engine ──> options with
Farmer: rotation, irrigation, priorities ─────────────────┘   hard limits, scores    reasons, evidence,
Crop maps (CDL / AAFC) pre-fill the rotation                   and text               gaps, local checks
```

- **Crop water use** = FAO-56 crop coefficient × the field's own monthly reference
  evapotranspiration (Hargreaves, FAO-56 eq. 52), over each crop's months.
- **Soil water storage** = each soil layer's available water capacity × its thickness,
  added down to the crop's root depth (SSURGO lists every layer). In Canada, available
  water comes from the AAFC soil grids' texture and organic matter through the Saxton &
  Rawls (2006) equations, for the top layer only, so it is applied to the whole root
  depth there. Using the top layer alone overstated it by 43% on the Nevada field, whose
  subsoil is sand; we found and fixed that by checking our numbers against the survey.
- **Erosion** weights each bare month by its share of the year's rain and heavy-rain days.
- **Scores** (0–1 for water, organic matter, nitrogen, erosion, pests, forage and market
  suitability) are weighted by the farmer's 0–5 priorities. Crops the farmer can't grow
  or sell (no buyer, no equipment) rule options out. The current rotation is always
  kept as the reference.

### The crop classifier: trained, tested honestly

- **Data:** NASA HLS v2.0 NDVI (Landsat 8/9 and Sentinel-2, 30 m), all 891 views of
  tile T18TVR for 2019–2024, cloud and shadow removed with the HLS Fmask; read straight
  from NASA's cloud with an Earthdata login. A 33 km window of farmland south of Ottawa.
- **Labels:** the AAFC Annual Crop Inventory, 30 m, for the same years. 23,080
  field-interior pixels (the middle of uniform 5 × 5 blocks, so field edges don't mix
  crops), up to 800 per crop and year: corn, soybeans, winter wheat, spring cereals
  (barley, oats, spring wheat) and hay or pasture.
- **Features:** median NDVI in 36 ten-day bins across the year, gaps interpolated.
- **Three approaches:** the nearest typical crop curve (baseline), XGBoost, and a small
  temporal convolutional network.
- **Honest test:** 2023–2024 pixels in 3 km blocks never used in training (new seasons
  and new places), 1,473 rows, used once. The model was chosen by leave-one-season-out
  cross-validation on 2019–2022. The Ottawa example field and 2 km around it were
  never in training.

| Approach | Correct on new seasons and places | Balanced score (macro F1) | Cross-validation macro F1 |
| --- | --- | --- | --- |
| Nearest typical curve (baseline) | 88.8% | 0.85 | 0.81 |
| **XGBoost** (chosen by cross-validation) | 88.5% | 0.84 | 0.81 |
| Temporal CNN | 74.9% | 0.69 | 0.66 |

*(2026-11-14, `tools/train_crop_model.py`.)* What this shows:

- **Corn, soybeans and hay are read reliably** (XGBoost F1 0.94, 0.95 and 0.96).
  **Winter wheat is the hard one** (0.50): it is confused with spring cereals, whose
  summer curve is similar; the difference is early-spring greenness, often hidden by
  snow and cloud in Ontario.
- **Late July and early October tell the crops apart most** (XGBoost feature gain:
  Jul 30, Oct 8, Aug 29): corn and soybeans are green while cereals are harvested, and
  hay is still green after the row crops.
- **A simple baseline is as good as XGBoost here, and deep learning did worse.** The
  limit is the year-to-year shift in weather and planting dates, not model capacity.
- **How we got here, honestly:** our first run validated on new *places* in the
  *training years*. It chose the CNN, which then did worst on the new-season test. A
  second run validated on one held-out season (470 rows), too few to choose reliably.
  The final protocol, leave-one-season-out, is the standard for this problem. All
  three runs are reported here; none was picked by its test score.
- **The labels are a model too.** AAFC's map is itself a classifier's output (AAFC
  reports roughly 85–90% accuracy in Ontario), so our model learns to reproduce that
  map from greenness alone. Where the two disagree, the tool says "worth a check":
  either can be wrong, and the farmer knows what they planted.

## Use of NASA data

- **NASA POWER** (Prediction Of Worldwide Energy Resources), daily point API, AG
  community: daily maximum and minimum temperature, corrected precipitation and
  top-of-atmosphere radiation, 2006–2025, for the field's grid cell. Everything about
  climate in the tool (frost, heat, heavy rain, crop water demand, the 3D weather)
  comes from it.

- **HLS v2.0 vegetation indices** (HLSL30_VI, HLSS30_VI), 30 m: the replay's monthly
  greenness and month states on the example fields, and the crop classifier's training
  data (891 views, read directly from NASA LP DAAC).
- **MODIS MOD13Q1 v6.1** (250 m, 16-day NDVI since 2000): the long history the unusual-
  month comparison forecasts from, and the replay's fallback when HLS saw only cloud.
- **MODIS MCD12Q2 v6.1** (500 m): green-up, peak and dormancy dates each year.
- **SMAP L3 enhanced SPL3SMP_E v6** (9 km, daily): surface soil moisture by month.
- Retrieved through **NASA AppEEARS** for the example field points.

## Space agency partner and other data

| Data | Used for | Credit |
| --- | --- | --- |
| USDA NRCS SSURGO | Soil at U.S. fields | Soil Survey Staff, NRCS, USDA |
| USDA NASS Cropland Data Layer | Past crops at U.S. fields | USDA NASS |
| AAFC Annual Crop Inventory | Past crops at Canadian fields | Agriculture and Agri-Food Canada; Open Government Licence – Canada |
| AAFC Soil Landscape Grids of Canada (100 m) | Soil at Canadian fields | AAFC, Canadian Soil Information Service; Open Government Licence – Canada |
| FAO-56 (Allen et al., 1998) | Crop coefficients, root depths, reference evapotranspiration | FAO |
| Saxton & Rawls (2006) | Water-holding capacity from soil texture | SSSA Journal 70: 1569–1578 |
| OpenStreetMap | Base map | © OpenStreetMap contributors |
| Google TimesFM 2.5 | Expected range for each month (unusual-month flags) | Apache-2.0 |
| XGBoost, scikit-learn, PyTorch | Crop classifier | Apache-2.0, BSD-3-Clause |

## What we don't know yet (and say so in the tool)

- **Bare-soil months come from typical crop calendars** for most fields; only the
  example fields have their satellite record (an AppEEARS request takes 30 minutes to
  hours). Each option lists this as a gap.
- **Clouds hide months.** Optical satellites miss cloudy months (unseen months repeat
  the month before, and the page says so). Canada's RADARSAT Constellation Mission sees
  through cloud and could fill those months: our next step.
- **The crop classifier is trained in eastern Ontario only** and reads five crop
  groups. It would need retraining elsewhere.
- **Weather is a grid cell about 50 km across.** A field's own microclimate can differ.
  In a desert valley like the Nevada example's, cold night air pools on the valley
  floor, so the grid's frost-free season (189 days) is likely too long and its rain (180
  mm a year) too high. [TODO: compare with the Fallon station's normals.] Check frost
  dates against the nearest weather station.
- **The water balance is a screen, not a crop model.** One average water-use
  coefficient per crop season (FAO-56), all season rain counted as usable (none lost to
  runoff), and the soil full at planting. That is enough to rule out what clearly can't
  work and to compare options, not to schedule irrigation.
- **The 0–1 scores are transparent rules of thumb**, not measurements: organic matter
  from living-cover months and deep roots, erosion from bare months weighted by rain and
  the soil's erodibility, pests from how many crop families the rotation has and whether
  a crop follows itself. Each option shows the reasons behind them.
- **Canadian soil is modelled at 100 m** and has no slope, drainage or erodibility, so
  erosion risk from the field's slope is shown as unknown there.
- **Income uses a general market class**, not local prices.
- **Every option ends with what to check locally:** drainage, equipment, buyers, local
  pest pressure and a soil test. The tool suggests; the farmer and their advisor decide.

## Why it matters

[TODO: who benefits and how many, with the checked figures. Keep it to what the tool
can honestly claim: better-informed rotation choices, and soil kept covered in the
months it is most at risk.]

## Use of AI

[TODO: confirm what the form asks.] The software was written with help from an AI
coding assistant (Anthropic's Claude), reviewed and tested by the team.

Inside the tool, models are used where they can be tested against data, and always
next to a simple baseline:

- **Unusual months:** Google's TimesFM 2.5, a pretrained time-series foundation model
  (used as published, not retrained), against a field-average baseline, both scored on
  held-out years. On 212 held-out months of greenness (2019–2024, the three example
  fields) TimesFM misses by 0.063 NDVI on average against 0.066 for the field
  average, and its 10–90% range held 85% of the months against 73%. On 199 months of
  SMAP surface soil moisture the errors are the same (0.031 m³/m³), and TimesFM's
  range held 86% against 57%. A 10–90% range should hold about 80%. So
  TimesFM is only slightly more accurate, but its range is much better calibrated.
  A month is flagged as unusual only when both methods put it outside their range:
  one method alone flagged up to 43 of the 72 months, and a farmer reads every flag
  as "something happened here". With both required, 7 to 13 months per field.
- **Which crop grew here:** a classifier we trained (XGBoost, chosen over a temporal
  CNN and a nearest-curve baseline by cross-validation), scored on new seasons and
  places (see How it works).

The rotation recommendations themselves come from transparent rules and published
equations, so every number can be traced to its data. We did not train a model to
recommend rotations: no dataset records which rotation improved which field's soil,
and a model without that answer to learn from would only look convincing.

## Links and team

- Demo video: [TODO]
- Live app: [TODO]
- Source code: [TODO]
- Team: [TODO]
