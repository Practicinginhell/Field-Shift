from dataclasses import replace

import pytest

from app.climate import hargreaves_et0, summarize
from tests.conftest import synthetic_daily


def test_hargreaves_matches_hand_calculation():
    # 0.0023 * (25 + 17.8) * sqrt(10) * 0.408 * 40
    assert hargreaves_et0(30, 20, 40) == pytest.approx(5.0803, abs=1e-3)


def test_summary_uses_only_complete_years(daily):
    cut = len(daily.dates) - 100  # drop the last 100 days of 2025
    partial = replace(
        daily,
        dates=daily.dates[:cut],
        tmax_c=daily.tmax_c[:cut],
        tmin_c=daily.tmin_c[:cut],
        precip_mm=daily.precip_mm[:cut],
        toa_radiation_mj=daily.toa_radiation_mj[:cut],
    )
    summary = summarize(partial)

    assert (summary.start_year, summary.end_year, summary.years_used) == (2006, 2024, 19)


def test_summary_rejects_too_few_years():
    with pytest.raises(ValueError, match="complete years"):
        summarize(synthetic_daily(years=4))


def test_frost_dates_and_season_follow_the_temperature_cycle(daily):
    summary = summarize(daily)

    # tmin crosses 0 °C around early April and late October in the synthetic cycle.
    assert "03-25" <= summary.last_spring_frost <= "04-20"
    assert "10-10" <= summary.first_fall_frost <= "11-10"
    assert 170 <= summary.frost_free_days <= 225


def test_rain_totals_and_heavy_rain_month(daily):
    summary = summarize(daily)

    assert summary.heavy_rain_days_per_year == 1.0
    assert summary.monthly_heavy_rain_days[5] == 1.0  # June
    assert summary.annual_precip_mm == pytest.approx(364 * 2 + 30, abs=3)


def test_no_frost_means_full_season_and_no_frost_dates():
    summary = summarize(synthetic_daily(winter_tmin=5.0))

    assert summary.frost_free_days == 365
    assert summary.last_spring_frost is None
    assert summary.first_fall_frost is None


def test_southern_hemisphere_frost_dates_are_calendar_dates():
    summary = summarize(synthetic_daily(latitude=-35.0))

    assert summary.southern_hemisphere
    # Southern spring frost falls in Sep–Oct, the autumn frost in Apr–May.
    assert "09-01" <= summary.last_spring_frost <= "11-01"
    assert "03-20" <= summary.first_fall_frost <= "05-31"


def test_recent_change_compares_last_ten_years_with_ten_before(daily):
    wetter = replace(
        daily,
        precip_mm=[
            p * (1.1 if d.year >= 2016 else 1.0)
            for d, p in zip(daily.dates, daily.precip_mm, strict=True)
        ],
    )
    summary = summarize(wetter)

    # Not exactly 10%: 2016–2025 has three leap days, 2006–2015 only two.
    assert summary.recent_precip_change_percent == pytest.approx(10.0, abs=0.1)
    assert summary.recent_tmax_change_c == pytest.approx(0.0, abs=0.01)
