import pytest

from app.models import AnalyzeRequest, Priorities, RotationYear
from app.rotation import Site, _same_rotation, analyze, evaluate
from app.sources.ssurgo import parse_sda
from tests.conftest import make_summary
from tests.test_sources import load

CORN_SOY = [{"crop": "corn"}, {"crop": "soybean"}]
SOIL = parse_sda(load("ssurgo_iowa.json"))


def request(rotation=CORN_SOY, irrigated=False, **priorities) -> AnalyzeRequest:
    return AnalyzeRequest(
        latitude=42.1,
        longitude=-93.95,
        current_rotation=rotation,
        irrigated=irrigated,
        priorities=Priorities(**priorities),
    )


def years(*crops: str) -> list[RotationYear]:
    return [RotationYear(crop=c) for c in crops]


def test_baseline_comes_first_with_at_least_two_alternatives():
    result = analyze(request(), make_summary(), SOIL)

    assert result.strategies[0].is_baseline
    assert result.strategies[0].name == "Corn – Soybean"
    assert len(result.strategies) >= 3
    assert not any(s.is_baseline for s in result.strategies[1:])


def test_every_strategy_has_all_five_parts():
    result = analyze(request(), make_summary(), SOIL)

    for s in result.strategies:
        assert s.why and s.evidence and s.benefits and s.gaps and s.local_review, s.name
        assert all(e.dataset and e.value and e.period and e.place for e in s.evidence)


def test_alternatives_are_sorted_and_never_repeat_a_rotation():
    result = analyze(request(), make_summary(), SOIL)
    alternatives = result.strategies[1:]

    assert [s.total for s in alternatives] == sorted((s.total for s in alternatives), reverse=True)
    rotations = [s.years for s in result.strategies]
    for i, a in enumerate(rotations):
        for b in rotations[i + 1 :]:
            assert not _same_rotation(a, b)


def test_short_season_removes_frost_sensitive_crops_with_a_reason():
    result = analyze(
        request(rotation=[{"crop": "spring_wheat"}, {"crop": "canola"}]),
        make_summary(frost_free_days=95),
        SOIL,
    )

    names = [s.name for s in result.strategies]
    assert not any("Corn" in n or "Soybean" in n or "Sorghum" in n for n in names)
    corn_soy = next(r for r in result.removed if r.name == "Corn – Soybean")
    assert "frost-free days" in corn_soy.reason and "95" in corn_soy.reason


def test_dry_site_rules_out_thirsty_crops_unless_irrigated():
    dry = make_summary(monthly_precip_mm=[5] * 12, annual_precip_mm=60)
    rainfed = analyze(request(rotation=[{"crop": "fallow"}]), dry, SOIL)
    irrigated = analyze(request(rotation=[{"crop": "fallow"}], irrigated=True), dry, SOIL)

    assert any("Without irrigation" in r.reason for r in rainfed.removed)
    assert len(irrigated.removed) < len(rainfed.removed)


def test_failing_baseline_is_kept_and_warned_about():
    result = analyze(request(), make_summary(frost_free_days=90), SOIL)

    base = result.strategies[0]
    assert base.is_baseline
    assert any("Corn" in w for w in base.warnings)


def test_raising_the_water_priority_favours_lower_water_use():
    soil_first = analyze(
        request(water=0, soil=5, erosion=5, pests=0, income=0), make_summary(), SOIL
    )
    water_first = analyze(
        request(water=5, soil=0, erosion=0, pests=0, income=0), make_summary(), SOIL
    )

    assert water_first.strategies[1].water_demand_mm < soil_first.strategies[1].water_demand_mm


def test_cover_crop_adds_cover_months_and_water_use():
    site = Site(make_summary(), SOIL, irrigated=False)
    plain = evaluate(years("corn", "soybean"), site)
    covered = evaluate(
        [RotationYear(crop="corn", cover=True), RotationYear(crop="soybean", cover=True)], site
    )

    assert covered.cover_months > plain.cover_months + 5
    assert covered.demand_mm > plain.demand_mm
    assert covered.scores["erosion"] > plain.scores["erosion"]


def test_corn_on_corn_scores_worse_on_pests_than_corn_soy():
    site = Site(make_summary(), SOIL, irrigated=False)

    assert (
        evaluate(years("corn", "corn"), site).scores["pests"]
        < evaluate(years("corn", "soybean"), site).scores["pests"]
    )


def test_perennial_years_are_not_counted_as_repeats():
    site = Site(make_summary(), SOIL, irrigated=False)
    alfalfa = evaluate(years("alfalfa", "alfalfa", "alfalfa", "corn"), site)

    assert alfalfa.scores["pests"] == pytest.approx(0.5)


def test_stored_soil_water_adds_up_each_layer_to_root_depth():
    from dataclasses import replace

    from app.crops import CROPS

    layered = replace(SOIL, horizons=((0.0, 30.0, 0.2), (30.0, 200.0, 0.05)))
    shallow = replace(SOIL, horizons=((0.0, 50.0, 0.2),))  # bedrock at 50 cm
    no_layers = replace(SOIL, available_water_cm_per_cm=0.15, horizons=())  # Canadian soil

    def storage(soil):
        return Site(make_summary(), soil, irrigated=False).soil_storage_mm(CROPS["corn"])

    # corn roots to 1.2 m: 30 cm x 0.2 + 90 cm x 0.05, in mm
    assert storage(layered) == pytest.approx(60 + 45)
    assert storage(shallow) == pytest.approx(100)
    assert storage(no_layers) == pytest.approx(0.15 * 1200)


def test_same_rotation_ignores_where_the_cycle_starts():
    assert _same_rotation(years("corn", "soybean"), years("soybean", "corn"))
    assert not _same_rotation(years("corn", "soybean"), years("corn", "corn"))


def test_without_soil_data_the_gap_is_stated_and_susceptibility_unknown():
    result = analyze(request(), make_summary(), None)

    assert result.conditions.soil is None
    assert result.conditions.erosion_susceptibility == "unknown"
    assert any("No soil data here" in g for g in result.strategies[0].gaps)


def test_unknown_crop_is_rejected():
    with pytest.raises(ValueError, match="unknown crops"):
        analyze(request(rotation=[{"crop": "dragonfruit"}]), make_summary(), SOIL)


def test_southern_hemisphere_shifts_crop_seasons():
    north = Site(make_summary(), SOIL, irrigated=False)
    south = Site(make_summary(southern_hemisphere=True), SOIL, irrigated=False)
    corn = years("corn")

    assert evaluate(corn, north).metrics[0].covered_months == frozenset({6, 7, 8, 9})
    assert evaluate(corn, south).metrics[0].covered_months == frozenset({12, 1, 2, 3})


def test_summary_sentences_agree_with_one_day():
    summary = analyze(
        request(), make_summary(heavy_rain_days_per_year=1.0, heat_days_per_year=1.2), SOIL
    )
    text = " ".join(summary.conditions.summary)

    assert "About 1 day a year brings heavy rain" in text
    assert "About 1 day a year reaches 35 °C" in text


def calendar_of(*spec: tuple[str, bool], summary=None) -> list[list]:
    from app.rotation import build_calendar

    site = Site(summary or make_summary(), SOIL, irrigated=False)
    return build_calendar([RotationYear(crop=c, cover=cov) for c, cov in spec], site)


def test_calendar_has_twelve_months_per_rotation_year():
    cal = calendar_of(("corn", False), ("soybean", False))

    assert len(cal) == 2 and all(len(year) == 12 for year in cal)


def test_corn_is_sown_in_may_grows_to_full_canopy_and_is_bare_in_winter():
    corn = calendar_of(("corn", False))[0]

    assert corn[4].state == "planted"  # May
    assert corn[6].state == "crop" and corn[6].growth == 1.0  # July
    assert corn[0].state == "bare" and corn[11].state == "bare"
    assert corn[6].water_mm == pytest.approx(0.85 * 170, abs=0.1)  # Kc x July ET0


def test_winter_wheat_is_sown_in_the_autumn_of_the_year_before():
    cal = calendar_of(("soybean", False), ("winter_wheat", False))
    soy, wheat = cal

    assert soy[9].crop == "winter_wheat"  # October of the soybean year
    assert wheat[3].crop == "winter_wheat"  # April of the wheat year
    assert wheat[9].state == "bare"  # wheat harvested in July, nothing sown after


def test_cover_crop_overwinters_into_the_next_year():
    cal = calendar_of(("corn", True), ("soybean", False))
    corn, soy = cal

    assert corn[10].state == "cover"  # November after corn
    assert soy[1].state == "cover"  # February of the soybean year
    assert soy[10].state == "bare"  # no cover after soybean
    assert corn[1].state == "bare"  # nothing before corn: soybean had no cover


def test_strategies_carry_their_calendar_and_conditions_their_frost_months():
    result = analyze(request(), make_summary(), SOIL)

    assert all(len(s.calendar) == len(s.years) for s in result.strategies)
    # Median frosts Apr 22 and Oct 19: frost months Jan–Apr and Oct–Dec.
    assert result.conditions.frost_months == [True] * 4 + [False] * 5 + [True] * 3


def test_southern_frost_months_run_from_autumn_to_spring():
    from app.rotation import frost_months

    south = make_summary(
        last_spring_frost="10-05", first_fall_frost="04-20", southern_hemisphere=True
    )

    assert frost_months(south) == [
        False,
        False,
        False,
        True,
        True,
        True,
        True,
        True,
        True,
        True,
        False,
        False,
    ]


# --- brief's priorities and constraints: nitrogen, forage, organic matter, crops excluded


def site() -> Site:
    return Site(climate=make_summary(), soil=SOIL, irrigated=False)


def test_nitrogen_score_is_the_share_of_legume_years():
    assert evaluate(years("corn", "soybean"), site()).scores["nitrogen"] == pytest.approx(0.5)
    assert evaluate(years("corn", "corn"), site()).scores["nitrogen"] == 0


def test_forage_score_rewards_forage_crops():
    hay = evaluate(years("alfalfa", "alfalfa", "alfalfa", "corn"), site()).scores["forage"]
    grain = evaluate(years("corn", "soybean"), site()).scores["forage"]

    assert hay > grain


def test_organic_matter_score_no_longer_counts_legumes():
    # Soybean and corn have the same cover months and root class here, so the
    # organic-matter ("soil") score must not prefer soybean for fixing nitrogen.
    soy = evaluate(years("soybean"), site()).scores["soil"]
    corn = evaluate(years("corn"), site()).scores["soil"]

    assert soy <= corn


def test_excluded_crops_rule_out_alternatives_with_the_reason():
    result = analyze(
        AnalyzeRequest(
            latitude=42.1,
            longitude=-93.95,
            current_rotation=CORN_SOY,
            excluded_crops=["canola", "alfalfa"],
        ),
        make_summary(),
        SOIL,
    )

    shown = " ".join(s.name for s in result.strategies[1:])
    assert "Canola" not in shown and "Alfalfa" not in shown
    reasons = [r.reason for r in result.removed if "Canola" in r.name]
    assert reasons and all("can't grow or sell canola" in r for r in reasons)


def test_the_current_rotation_is_kept_even_if_it_has_an_excluded_crop():
    result = analyze(
        AnalyzeRequest(
            latitude=42.1, longitude=-93.95, current_rotation=CORN_SOY, excluded_crops=["corn"]
        ),
        make_summary(),
        SOIL,
    )

    assert result.strategies[0].is_baseline
    assert result.strategies[0].name == "Corn – Soybean"


def test_unknown_excluded_crop_is_rejected():
    with pytest.raises(ValueError, match="kale"):
        analyze(
            AnalyzeRequest(
                latitude=42.1, longitude=-93.95, current_rotation=CORN_SOY, excluded_crops=["kale"]
            ),
            make_summary(),
            SOIL,
        )


def test_cover_crop_on_spring_crop_does_not_double_count_overlapping_april_water():
    from app.crops import COVER_RYE, CROPS

    s = site()
    plain = evaluate([RotationYear(crop="spring_wheat", cover=False)], s)
    covered = evaluate([RotationYear(crop="spring_wheat", cover=True)], s)
    # Spring wheat already uses April (month 4); rye only adds Oct, Nov, Mar (10, 11, 3).
    expected_extra = COVER_RYE.kc_season * sum(
        s.climate.monthly_et0_mm[m - 1]
        for m in COVER_RYE.season_months
        if m not in CROPS["spring_wheat"].season_months
    )
    assert covered.demand_mm - plain.demand_mm == pytest.approx(expected_extra)


def test_fractional_cover_months_are_formatted_consistently_in_benefits_and_strategy():
    result = analyze(
        request(
            rotation=[{"crop": "spring_wheat"}, {"crop": "field_pea"}],
            erosion=5,
            pests=5,
            water=5,
            soil=0,
        ),
        make_summary(),
        SOIL,
    )
    wheat_canola_pea = next(s for s in result.strategies if s.id == "wheat-canola-pea")

    assert wheat_canola_pea.cover_months == 10.3
    benefits_text = " ".join(wheat_canola_pea.benefits)
    assert "10.3 months" in benefits_text
    assert "about 10 months" not in benefits_text


def test_steep_erodible_soil_lowers_bare_month_erosion_score():
    from dataclasses import replace

    flat_soil = replace(SOIL, slope_percent=1.0, erodibility_k=0.20)
    steep_soil = replace(SOIL, slope_percent=9.0, erodibility_k=0.40)
    flat = evaluate(years("corn", "soybean"), Site(make_summary(), flat_soil, irrigated=False))
    steep = evaluate(years("corn", "soybean"), Site(make_summary(), steep_soil, irrigated=False))

    assert steep.scores["erosion"] < flat.scores["erosion"]


def test_rainfed_water_shortfall_and_heat_days_reduce_income_and_adjacent_family_reduces_pests():
    well_watered = Site(make_summary(heat_days_per_year=1.0), SOIL, irrigated=True)
    hot_rainfed = Site(
        make_summary(monthly_precip_mm=[32] * 12, annual_precip_mm=384, heat_days_per_year=8.0),
        SOIL,
        irrigated=False,
    )
    assert (
        evaluate(years("canola"), hot_rainfed).scores["income"]
        < evaluate(years("canola"), well_watered).scores["income"]
    )
    # Canola in >1/3 of years (50%) and adjacent same-family annuals reduce the pest score.
    two_canola = evaluate(years("canola", "spring_wheat"), well_watered)
    soy_wheat = evaluate(years("soybean", "spring_wheat"), well_watered)
    assert two_canola.scores["pests"] < soy_wheat.scores["pests"]
    adj_grass = evaluate(years("corn", "winter_wheat", "soybean"), well_watered)
    three_fam = evaluate(years("canola", "winter_wheat", "soybean"), well_watered)
    assert adj_grass.scores["pests"] < three_fam.scores["pests"]


def test_candidate_generator_creates_tailored_mutations_for_custom_rotations():
    # 1. Monoculture corn-on-corn gets a repeat-breaking alternative that explains the swap
    mono = analyze(
        request(rotation=[{"crop": "corn"}, {"crop": "corn"}]),
        make_summary(),
        SOIL,
    )
    assert any("Replaces a repeated" in " ".join(s.why) for s in mono.strategies[1:])

    # 2. Spring wheat + canola (missing legume) gets a 3-year extension keeping both crops
    no_legume = analyze(
        request(
            rotation=[{"crop": "spring_wheat"}, {"crop": "canola"}],
            nitrogen=5,
            pests=5,
        ),
        make_summary(),
        SOIL,
    )
    ext = [
        s
        for s in no_legume.strategies[1:]
        if {"spring_wheat", "canola"}.issubset({y.crop for y in s.years}) and len(s.years) == 3
    ]
    assert ext
    assert any("Keeps your current crops and adds" in " ".join(s.why) for s in ext)
