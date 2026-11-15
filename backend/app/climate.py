"""Climate features for one field, computed from NASA POWER daily data.

Every number here is computed from the daily series; nothing is assumed. Reference
evapotranspiration (ET0) uses the Hargreaves equation (FAO Irrigation and Drainage
Paper 56, eq. 52), which needs only temperature and top-of-atmosphere radiation.
"""

import math
from dataclasses import dataclass
from datetime import date, timedelta
from statistics import mean, median

from app.sources.power import DailyClimate

FROST_C = 0.0
HEAT_C = 35.0
HEAVY_RAIN_MM = 25.0
_HALF_YEAR = timedelta(days=182)


def hargreaves_et0(tmax: float, tmin: float, ra_mj: float) -> float:
    """Reference evapotranspiration in mm/day (FAO-56 eq. 52).

    `ra_mj` is extraterrestrial radiation in MJ m-2 day-1; 0.408 converts it to mm/day.
    """
    tmean = (tmax + tmin) / 2
    return 0.0023 * (tmean + 17.8) * math.sqrt(max(tmax - tmin, 0.0)) * 0.408 * ra_mj


@dataclass(frozen=True)
class ClimateSummary:
    start_year: int
    end_year: int
    years_used: int
    annual_precip_mm: float
    annual_et0_mm: float
    monthly_precip_mm: list[float]
    monthly_et0_mm: list[float]
    monthly_heavy_rain_days: list[float]
    monthly_heat_days: list[float]
    last_spring_frost: str | None
    """Median calendar date as "MM-DD"; `None` if frost happens in fewer than half the years."""
    first_fall_frost: str | None
    frost_free_days: int
    """Median days between the last spring frost and the first fall frost."""
    heat_days_per_year: float
    heavy_rain_days_per_year: float
    recent_precip_change_percent: float | None
    """Last 10 years' mean annual rain vs the 10 before, in percent."""
    recent_tmax_change_c: float | None
    """Last 10 years' mean daily maximum temperature vs the 10 before, in °C."""
    southern_hemisphere: bool


def _complete_years(climate: DailyClimate) -> list[int]:
    counts: dict[int, int] = {}
    for d, tx, tn, p, ra in zip(
        climate.dates,
        climate.tmax_c,
        climate.tmin_c,
        climate.precip_mm,
        climate.toa_radiation_mj,
        strict=True,
    ):
        if None not in (tx, tn, p, ra):
            counts[d.year] = counts.get(d.year, 0) + 1
    return sorted(y for y, n in counts.items() if n >= 360)


def _mmdd(day_of_year: float, south: bool) -> str:
    """Day of the (possibly shifted) season year as a calendar "MM-DD"."""
    d = date(2001, 1, 1) + timedelta(days=round(day_of_year) - 1)
    if south:
        d -= _HALF_YEAR
    return d.strftime("%m-%d")


def summarize(climate: DailyClimate) -> ClimateSummary:
    """Compute the climate features over the complete years in `climate`.

    Raises `ValueError` if fewer than 5 complete years are available, because frost
    dates and trends from fewer years would mislead.
    """
    years = _complete_years(climate)
    if len(years) < 5:
        raise ValueError(f"only {len(years)} complete years of NASA POWER data")
    year_set = set(years)
    south = climate.latitude < 0

    precip_by_year = dict.fromkeys(years, 0.0)
    et0_by_year = dict.fromkeys(years, 0.0)
    tmax_by_year: dict[int, list[float]] = {y: [] for y in years}
    month_precip = [0.0] * 12
    month_et0 = [0.0] * 12
    month_heavy = [0] * 12
    month_heat = [0] * 12
    heat_days = 0
    heavy_days = 0
    spring_frost: dict[int, int] = {}
    fall_frost: dict[int, int] = {}

    for d, tx, tn, p, ra in zip(
        climate.dates,
        climate.tmax_c,
        climate.tmin_c,
        climate.precip_mm,
        climate.toa_radiation_mj,
        strict=True,
    ):
        if d.year not in year_set or None in (tx, tn, p, ra):
            continue
        et0 = hargreaves_et0(tx, tn, ra)
        precip_by_year[d.year] += p
        et0_by_year[d.year] += et0
        tmax_by_year[d.year].append(tx)
        month_precip[d.month - 1] += p
        month_et0[d.month - 1] += et0
        if p >= HEAVY_RAIN_MM:
            heavy_days += 1
            month_heavy[d.month - 1] += 1
        if tx >= HEAT_C:
            heat_days += 1
            month_heat[d.month - 1] += 1
        if tn <= FROST_C:
            # In the southern hemisphere, shift by half a year so that the growing
            # season sits in the middle of the "season year", as it does in the north.
            shifted = d + _HALF_YEAR if south else d
            doy = shifted.timetuple().tm_yday
            season_year = shifted.year
            if doy < 182:
                spring_frost[season_year] = max(spring_frost.get(season_year, 0), doy)
            elif season_year not in fall_frost:
                fall_frost[season_year] = doy

    n = len(years)
    frost_free = []
    for y in years:
        last = spring_frost.get(y, 0)
        first = fall_frost.get(y, 366)
        frost_free.append(first - last - 1)
    spring_days = [spring_frost[y] for y in years if y in spring_frost]
    fall_days = [fall_frost[y] for y in years if y in fall_frost]

    recent_precip = recent_tmax = None
    if n >= 20:
        old, new = years[-20:-10], years[-10:]
        p_old = mean(precip_by_year[y] for y in old)
        p_new = mean(precip_by_year[y] for y in new)
        recent_precip = 100 * (p_new - p_old) / p_old if p_old > 0 else None
        recent_tmax = mean(mean(tmax_by_year[y]) for y in new) - mean(
            mean(tmax_by_year[y]) for y in old
        )

    return ClimateSummary(
        start_year=years[0],
        end_year=years[-1],
        years_used=n,
        annual_precip_mm=mean(precip_by_year.values()),
        annual_et0_mm=mean(et0_by_year.values()),
        monthly_precip_mm=[v / n for v in month_precip],
        monthly_et0_mm=[v / n for v in month_et0],
        monthly_heavy_rain_days=[v / n for v in month_heavy],
        monthly_heat_days=[v / n for v in month_heat],
        # A frost date counts only if it happens in at least half of the years.
        last_spring_frost=_mmdd(median(spring_days), south) if len(spring_days) * 2 >= n else None,
        first_fall_frost=_mmdd(median(fall_days), south) if len(fall_days) * 2 >= n else None,
        frost_free_days=round(median(frost_free)),
        heat_days_per_year=heat_days / n,
        heavy_rain_days_per_year=heavy_days / n,
        recent_precip_change_percent=recent_precip,
        recent_tmax_change_c=recent_tmax,
        southern_hemisphere=south,
    )
