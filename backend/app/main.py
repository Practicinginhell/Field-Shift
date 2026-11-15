"""FastAPI entry point. Run with `./scripts/dev api`."""

import logging
import os
from datetime import date
from pathlib import Path

import httpx2
from fastapi import FastAPI, HTTPException, Query

from app import __version__
from app.climate import summarize
from app.crops import ACI_TO_CROP, CDL_TO_CROP, CROPS
from app.economics import add_margins, budget_for
from app.envfile import load_env_file
from app.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    CropHistory,
    CropHistoryYear,
    CropOption,
    ObservedField,
)
from app.observed import find_observed, satellite_evidence
from app.rotation import analyze
from app.sources import aafc, cdl, power, ssurgo

log = logging.getLogger(__name__)
if env_file := os.environ.get("ENV_FILE"):  # set by ./scripts/dev; tests leave it unset
    load_env_file(Path(env_file))
CLIMATE_YEARS = 20
CROP_HISTORY_YEARS = 6

app = FastAPI(title="Crop rotation decision support", version=__version__)


@app.get("/api/health")
def health() -> dict[str, str]:
    """Report that the API is up, and which version is running."""
    return {"status": "ok", "version": __version__}


@app.get("/api/crops")
def crops() -> list[CropOption]:
    """Crops the rotation editor offers."""
    return [
        CropOption(key=c.key, name=c.name, cover_crop_ok=c.cover_crop_ok) for c in CROPS.values()
    ]


@app.post("/api/analyze")
def analyze_field(request: AnalyzeRequest) -> AnalyzeResponse:
    """Compare the farmer's current rotation with alternatives, using real data for the field.

    Climate (NASA POWER) is required: if it fails, the request fails with 502. Soil is
    optional: SSURGO in the U.S., else the AAFC soil grids in Canada; elsewhere, or if
    the services fail, the analysis runs without it and says so. On the example fields,
    what satellites saw (2019–2024) is added as evidence for the current rotation.
    """
    end_year = date.today().year - 1
    try:
        daily = power.fetch_power(
            request.latitude, request.longitude, end_year - CLIMATE_YEARS + 1, end_year
        )
    except httpx2.HTTPError as exc:
        raise HTTPException(502, f"NASA POWER could not be reached: {exc}") from exc
    try:
        climate = summarize(daily)
    except ValueError as exc:
        raise HTTPException(502, f"NASA POWER returned too little data: {exc}") from exc

    ssurgo_failed = False
    try:
        soil = ssurgo.fetch_soil(request.latitude, request.longitude)
    except (httpx2.HTTPError, ValueError) as exc:  # optional source: degrade and say so
        log.warning("SSURGO lookup failed: %s", exc)
        soil, ssurgo_failed = None, True
    us_soil = soil is not None
    if soil is None:
        try:
            soil = aafc.fetch_soil(request.latitude, request.longitude)
        except (httpx2.HTTPError, ValueError) as exc:
            log.warning("AAFC soil lookup failed: %s", exc)
    soil_note = (
        "The soil survey service did not answer, so soil data is missing."
        if ssurgo_failed and soil is None
        else None
    )

    try:
        result = analyze(request, climate, soil)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if soil_note:
        result.notes.append(soil_note)
    if field := find_observed(request.latitude, request.longitude):
        # What satellites saw on this field is evidence about the rotation it has had:
        # the farmer's current one, not the alternatives.
        evidence, review = satellite_evidence(field, climate.monthly_heavy_rain_days)
        baseline = result.strategies[0]
        baseline.evidence.extend(evidence)
        baseline.local_review.extend(review)
    add_margins(result, request, budget_for(request.latitude, request.longitude, us_soil))
    return result


@app.get("/api/observed")
def observed(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
) -> ObservedField:
    """What NASA satellites saw on the field, 2019–2024: monthly greenness and state,
    season dates, soil moisture and stress flags. Prepared offline for the example
    fields only (an AppEEARS request takes about half an hour)."""
    field = find_observed(latitude, longitude)
    if field is None:
        raise HTTPException(
            404,
            "Satellite replay is prepared for the example fields only. This field shows "
            "typical crop calendars.",
        )
    return field


@app.get("/api/crop-history")
def crop_history(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
) -> CropHistory:
    """Past crops at a point, newest year last: Canada first, then the U.S.

    The AAFC Annual Crop Inventory answers in about 0.1 s and says "NoData" outside
    Canada, so it is tried first. Otherwise the USDA Cropland Data Layer is used, which
    is slow (tens of seconds per year). The page calls this only to pre-fill the rotation
    editor. Years that fail come back with `crop: null`.
    """
    this_year = date.today().year
    canada = [
        aafc.fetch_aci_year(latitude, longitude, year)
        for year in range(this_year - CROP_HISTORY_YEARS, this_year)
    ]
    if any(r.category for r in canada):  # published the spring after the season
        return CropHistory(
            years=[
                CropHistoryYear(
                    year=r.year, cdl_category=r.category, crop=ACI_TO_CROP.get(r.category or "")
                )
                for r in canada
            ],
            source="AAFC Annual Crop Inventory (Agriculture and Agri-Food Canada)",
        )

    last = this_year - 2  # CDL for a year is published early the year after next
    years = []
    for year in range(last - CROP_HISTORY_YEARS + 1, last + 1):
        result = cdl.fetch_crop_year(latitude, longitude, year)
        years.append(
            CropHistoryYear(
                year=year,
                cdl_category=result.category,
                crop=CDL_TO_CROP.get(result.category or ""),
            )
        )
    return CropHistory(years=years, source="USDA NASS Cropland Data Layer (CropScape)")
