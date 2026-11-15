# Field Shift: Vision

**Status:** draft, 2026-11-14. Written against the Space Apps Ottawa 2026 judging
rubric: Impact, Creativity, Validity, Relevance and Presentation.
Update this file when the direction changes.

## In one sentence

Field Shift helps a farmer see how their own field's weather, water and soil have been
changing, and compare their current crop rotation with other options. Each option is
explained with NASA evidence, honest about what the data can't tell, and clear about
what a local advisor should check.

## Why it matters (Impact)

Farmers choose rotations under new pressures: hotter summers, less reliable rain,
water limits and soil loss. A wrong choice costs a season, and the information that
would help sits in satellite and climate archives most farmers never open.

- **Who benefits first:** small and mid-size farms without an agronomist on call, and
  the extension advisors who serve many farms at once. One advisor using the tool can
  prepare evidence for dozens of farm visits.
- **How big it is:** agriculture uses about 70% of the world's freshwater withdrawals
  (FAO AQUASTAT). There are roughly 570 million farms worldwide (Lowder et al., 2016,
  *World Development*). *Check both figures before they go on the project page.*
- **What changes for a farmer:** instead of "what did we grow last year", the question
  becomes "what does 20 years of data say about my field, and which rotation fits what
  I care about". A rotation that keeps soil covered or uses less water pays back over
  many seasons.

## What we are building

A web tool a farmer or advisor uses in a few minutes:

1. **Pick the field** on a map.
2. **Tell us the current rotation**, or pre-fill it from the USDA crop map in the U.S.
3. **Say what matters:** saving water, soil health, erosion, pest cycles, income.
4. **Read the answer:** the field's conditions in plain words, then the current
   rotation and the best alternatives side by side. Each has the five parts the
   challenge asks for: why it was suggested, the evidence, the possible benefits, what
   we don't know, and what to check locally. Options that can't work on this field are
   listed with the reason.

### Principles we don't trade away

- **Support, not replace.** The tool suggests options to explore. The farmer and their
  advisor decide, and every option says what they should check.
- **Every number has a source.** Each value names its dataset, period and scale. If we
  don't have a value, we say so; we never show a placeholder as real.
- **Code computes, any model explains.** Scores and evidence come from data and stated
  formulas. If an SI (super intelligence) layer writes explanations, it only explains
  numbers our code produced.
- **Plain language first.** Science terms are explained the first time they appear.
- **Honest scale.** NASA POWER describes the area around the field (about 50 km). Soil
  survey data describes the field. The page says which is which.
- **Works everywhere, best where data is richest.** The U.S. gets field-level soil and
  crop history. Elsewhere the tool still works and states what is missing.

## How we score on each criterion

Status key: ✅ shown in the current demo · 🟡 partly · ⬜ not yet.

### 1. Impact: a meaningful problem, many people, real change

| Claim | Status | Evidence or next step |
| --- | --- | --- |
| Addresses rotation choice under climate and water pressure | ✅ | Conditions summary shows rain vs water demand, frost season, heat and heavy-rain days, and 10-year change |
| Works for any farm on Earth | 🟡 | Climate works worldwide. Soil and crop history are U.S.-only today |
| Serves the local judges' region (Ottawa) | 🟡 | Ottawa field runs, but without soil or crop history. Next: Canadian soil and crop data (owner decision, see below) |
| Shows the scale of the problem | ⬜ | Add two or three checked figures to the project page |

### 2. Creativity: something new

What sets Field Shift apart from a dashboard of satellite layers:

- **It starts from the farmer's rotation, not from the data.** The current rotation is
  always the reference, and every alternative is explained relative to it.
- **It is honest by design.** Evidence, gaps and local-review notes are part of every
  answer, and ruled-out options show their reason. Few tools say what they don't know.
- **It uses the field's own climate for crop water use** (crop coefficient × local
  evapotranspiration), not a generic table.

Ideas to strengthen this over the weekend, best first:

| Idea | Why judges would notice | Effort |
| --- | --- | --- |
| **"Your field then and now":** the last 10 years against the 10 before, as a side-by-side calendar of frost, heat and dry months | Makes climate change on *this* field visible in one picture | Low: the data is already computed |
| **Bare-soil calendar from satellite** (NDVI) next to the crop calendar | Shows the tool *sees* the field. Also raises Validity | Medium: needs Earthdata login |
| **What-if sliders** (rain −20%, +2 °C) that re-rank the options | Named in the brief; shows the rotation that holds up in a drier future | Low–medium |
| **One-page field brief** to print or send to an advisor | Turns "support, not replace" into an action | Low |
| **SI explanation layer** that answers "why not alfalfa?" from our numbers only | Uses SI the way the brief describes, without inventing figures | Medium |

### 3. Validity: scientifically sound, works, could work after the event

| Claim | Status | Evidence or next step |
| --- | --- | --- |
| Methods are standard and cited | ✅ | Hargreaves reference ET (FAO-56 eq. 52), FAO-56 crop coefficients and root depths, SSURGO soil properties |
| Every number traceable to data | ✅ | Evidence items name dataset, variable, period, place and scale |
| Hard limits are agronomic and explained | ✅ | Frost-free season vs crop needs; rain plus soil storage vs crop use without irrigation |
| Tested | ✅ | 38 backend and 8 frontend tests on recorded real responses; live runs in Iowa, Nevada and Ottawa |
| Bare-soil months observed, not assumed | ⬜ | Today they come from typical crop calendars. Next: Landsat/Sentinel-2 NDVI for the field |
| Satellite estimates checked against ground data | ⬜ | Compare NASA POWER rain with PRISM or CoCoRaHS for the demo field, and show the difference as uncertainty |
| Crop values reviewed by an agronomist | ⬜ | Ask a local extension advisor to review `backend/app/crops.py`; record who reviewed it |
| Could run after the hackathon | ✅ | Free, keyless public APIs, a disk cache, and an open-source stack |

**Known limits we state openly:** weather is regional (about 50 km); crop values are
general; income uses market classes, not local prices; pest effects are reduced to
crop-family diversity.

### 4. Relevance: answers this challenge, feasible, complete, easy to use

The brief's asks against what exists:

| The brief asks for | Status |
| --- | --- |
| NASA Earth observations combined with local soil, crop characteristics and farmer priorities | ✅ NASA POWER + SSURGO + crop table + priority sliders |
| At least three rotation strategies including the existing one | ✅ |
| For each: why, evidence, benefits, information gaps, risks for local review | ✅ |
| Times when fields are typically bare | 🟡 from crop calendars; satellite next |
| Seasons when current crops are more vulnerable | 🟡 frost, heat and dry months shown for the field; not yet per crop stage |
| Rotations that break pest cycles, cut water demand, improve infiltration, add income | 🟡 pests, water and income scored; infiltration not yet |
| Plain explanations of ET, soil-moisture anomaly, NDVI, frost risk, water balance | 🟡 ET, frost and water balance explained; NDVI and soil moisture come with their data |
| Satellite vs ground data explained | ⬜ |
| SI or statistical approaches, and how uncertainty is handled | 🟡 statistical features and stated gaps; SI layer and uncertainty ranges not yet |
| Harmonized datasets on a common grid | ⬜ point-based today; needed once gridded data arrives |
| Interactive map, field vulnerabilities, timelines, sliders | 🟡 map for picking the field; layers, timeline and sliders not yet |
| Easy for farmers with little technical experience | ✅ three steps, plain language, works on a phone (checked at 400 px) |
| Reminders that it supports, not replaces, local expertise | ✅ on every answer |

### 5. Presentation: explain the problem, the solution, why it matters

The NASA project page is what judges read first, so it gets the same care as the code.

**Demo story and project page:** drafts in [demo_script.md](demo_script.md) and
[project_page.md](project_page.md). (The earlier "Ottawa has no soil data" moment is
gone: Canadian fields now get AAFC crop history and soil.)

## Weekend priorities

Ranked by rubric gain for the effort. Each item keeps the demo path working.

1. **Project page and demo script** (Presentation). Draft early, refine at the end.
2. **"Your field then and now" view** (Creativity, Impact). The data is already there.
3. **Satellite bare-soil calendar from NDVI** (Validity, Relevance). Needs Earthdata.
4. **What-if sliders** for rain and temperature (Relevance, Creativity).
5. **Ground check:** NASA POWER rain against PRISM for the demo field, shown as
   uncertainty (Validity).
6. **Canadian data for the Ottawa field** (Impact for local judges). Owner decision.
7. **SI explanation layer** grounded in our numbers (Creativity). Only after 1–5 work.

**Out of scope this weekend:** accounts and saved farms, market prices, yield
prediction, a mobile app, and any feature that would show numbers we can't source.

## Open decisions for the team

- **Lead demo region:** Iowa (richest data) or a field near Ottawa (local judges)? We
  recommend leading with Iowa and showing Ottawa as the "works everywhere" moment.
- **Canadian data:** add Agriculture and Agri-Food Canada's crop inventory and
  Canadian soil data? These are not on the challenge's resource list, so we would
  check their terms first.
- **Earthdata account** for SMAP, IMERG and NDVI: who creates it, and when.
- **Agronomist review** of the crop table: who we can ask this weekend.

## Risks

| Risk | Effect | What we do |
| --- | --- | --- |
| A data service is down during judging | Demo fails | Disk cache: run every demo field once before judging |
| Judges question a crop value | Validity drops | Label general values, cite FAO-56, invite local review |
| Too many features, none finished | Relevance and presentation drop | Keep the demo path green; add one feature at a time |
| The Ottawa field looks thin | Impact drops for local judges | Say what's missing; add Canadian data if the team agrees |
