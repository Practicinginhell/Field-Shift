import math
from datetime import date, timedelta

import pytest

from app.climate import ClimateSummary
from app.sources.power import DailyClimate


def synthetic_daily(
    start_year: int = 2006,
    years: int = 20,
    latitude: float = 42.0,
    winter_tmin: float = -10.0,
    summer_tmin: float = 18.0,
    rain_mm: float = 2.0,
) -> DailyClimate:
    """Daily climate with a smooth seasonal cycle and one 30 mm storm each June 15.

    Minimum temperature follows a cosine from `winter_tmin` (mid-January) to
    `summer_tmin` (mid-July); the maximum is 10 °C above it. Radiation is constant.
    """
    dates, tmax, tmin, rain, ra = [], [], [], [], []
    d = date(start_year, 1, 1)
    end = date(start_year + years, 1, 1)
    phase_shift = 182 if latitude < 0 else 0
    while d < end:
        doy = d.timetuple().tm_yday
        x = math.cos(2 * math.pi * (doy - 15 - phase_shift) / 365)
        tn = summer_tmin + (winter_tmin - summer_tmin) * (x + 1) / 2
        dates.append(d)
        tmin.append(tn)
        tmax.append(tn + 10)
        rain.append(30.0 if (d.month, d.day) == (6, 15) else rain_mm)
        ra.append(30.0)
        d += timedelta(days=1)
    return DailyClimate(dates, tmax, tmin, rain, ra, latitude, -90.0)


@pytest.fixture
def daily() -> DailyClimate:
    return synthetic_daily()


def make_summary(**overrides) -> ClimateSummary:
    """A temperate, moderately wet climate summary for rotation tests."""
    values = dict(
        start_year=2006,
        end_year=2025,
        years_used=20,
        annual_precip_mm=850.0,
        annual_et0_mm=1000.0,
        monthly_precip_mm=[30, 30, 50, 80, 110, 120, 100, 100, 80, 60, 50, 40],
        monthly_et0_mm=[10, 15, 35, 70, 115, 150, 170, 150, 110, 70, 30, 15],
        monthly_heavy_rain_days=[0, 0, 0.2, 0.5, 1, 1.2, 0.8, 0.8, 0.5, 0.3, 0.2, 0],
        monthly_heat_days=[0, 0, 0, 0, 0, 0.5, 1.5, 1, 0, 0, 0, 0],
        last_spring_frost="04-22",
        first_fall_frost="10-19",
        frost_free_days=176,
        heat_days_per_year=3.0,
        heavy_rain_days_per_year=5.5,
        recent_precip_change_percent=-5.0,
        recent_tmax_change_c=0.5,
        southern_hemisphere=False,
    )
    values.update(overrides)
    return ClimateSummary(**values)
