"""Build, check and compare crop-rotation strategies for one field.

Pure functions: given the field's climate summary, its soil (or `None`) and the farmer's
inputs, return the baseline and the best alternatives, each with the five parts the
challenge asks for (why, evidence, benefits, gaps, local review). Every number in the
text comes from the data passed in. Scoring is deliberately simple and visible: five
criteria from 0 to 1, weighted by the farmer's priorities.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from app.climate import ClimateSummary
from app.crops import COVER_RYE, CROPS, Crop
from app.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    Conditions,
    Criterion,
    Evidence,
    MonthState,
    RemovedStrategy,
    RotationYear,
    Soil,
    Strategy,
)
from app.sources import power
from app.sources.ssurgo import SoilInfo

CRITERIA: tuple[Criterion, ...] = (
    "water",
    "soil",
    "nitrogen",
    "erosion",
    "pests",
    "forage",
    "income",
)
CRITERION_LABEL = {
    "water": "saving water",
    "soil": "adding organic matter",
    "nitrogen": "fixing nitrogen",
    "erosion": "reducing erosion",
    "pests": "breaking pest cycles",
    "forage": "forage for livestock",
    "income": "market suitability",
}
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
MARKET_SCORE = {"high": 1.0, "medium": 0.6, "low": 0.3, "none": 0.0}
FORAGE_SCORE = MARKET_SCORE  # same four classes, same steps
SUSCEPTIBILITY_FACTOR = {"low": 0.85, "unknown": 1.0, "moderate": 1.15, "high": 1.35}
ASSUMED_AWC = 0.15
"""Available water capacity (cm/cm) assumed when no soil data exists: a typical loam."""
RAINFED_MIN_RATIO = 0.6
"""Below this share of crop water use covered by rain plus soil storage, a rainfed crop
is ruled out."""
MAX_ALTERNATIVES = 3
FAO56_URL = "https://www.fao.org/4/x0490e/x0490e00.htm"  # FAO Irrigation and Drainage Paper 56

TEMPLATES: tuple[tuple[str, tuple[tuple[str, bool], ...]], ...] = (
    ("corn-soy", (("corn", False), ("soybean", False))),
    ("corn-soy-wheat", (("corn", False), ("soybean", False), ("winter_wheat", False))),
    ("corn-soy-rye", (("corn", True), ("soybean", True))),
    ("alfalfa-corn", (("alfalfa", False), ("alfalfa", False), ("alfalfa", False), ("corn", False))),
    ("sorghum-wheat-pea", (("sorghum", True), ("winter_wheat", False), ("field_pea", True))),
    ("wheat-canola-pea", (("spring_wheat", True), ("canola", True), ("field_pea", True))),
    (
        "oats-alfalfa-corn-soy",
        (
            ("oats", False),
            ("alfalfa", False),
            ("alfalfa", False),
            ("corn", False),
            ("soybean", False),
        ),
    ),
    ("wheat-sorghum-fallow", (("winter_wheat", False), ("sorghum", False), ("fallow", False))),
    ("barley-pea-canola", (("barley", True), ("field_pea", True), ("canola", True))),
)

CROP_RISKS = {
    "alfalfa": "Alfalfa needs a hay buyer or your own livestock, and a few years to pay back "
    "its establishment. Check local hay demand.",
    "canola": "Canola needs a buyer within reach, and its disease risk (for example "
    "sclerotinia) depends on local conditions.",
    "winter_wheat": "Winter wheat must survive the winter. Check local winterkill risk and "
    "suitable varieties.",
    "field_pea": "Field pea loses yield in hot spells during flowering.",
    "sorghum": "Check that a local buyer takes sorghum grain or forage.",
    "fallow": "A fallow year saves water but leaves soil bare. Keep crop residue on the "
    "surface to limit erosion.",
}
COVER_RISK = (
    "A cover crop needs seed, a planting window right after harvest, and a plan to end it "
    "in spring before planting. Check the timing with your equipment."
)


# ----------------------------------------------------------------------------- months


def _shift(month: int, south: bool) -> int:
    """Move a northern-hemisphere calendar month to the field's hemisphere."""
    return (month + 5) % 12 + 1 if south else month


def _months(months: Sequence[int], south: bool) -> set[int]:
    return {_shift(m, south) for m in months}


def _month_range(months: set[int]) -> str:
    """Describe a set of months as "May–Sep" when contiguous, else list them."""
    if not months:
        return "no months"
    ordered = sorted(months)
    # Rotate so a range that wraps the year end (e.g. Oct–Jun) starts at its real start.
    for i in range(len(ordered)):
        run = ordered[i:] + ordered[:i]
        if all((run[k] % 12) + 1 == run[k + 1] for k in range(len(run) - 1)):
            return f"{MONTHS[run[0] - 1]}–{MONTHS[run[-1] - 1]}"
    return ", ".join(MONTHS[m - 1] for m in ordered)


def _months_str(value: float) -> str:
    """Format a month count cleanly to 1 decimal place without trailing `.0`."""
    return f"{round(value, 1):g}"


# ---------------------------------------------------------------------------- metrics


@dataclass(frozen=True)
class YearMetrics:
    crop: Crop
    cover: bool
    demand_mm: float
    supply_mm: float
    covered_months: frozenset[int]


@dataclass(frozen=True)
class Site:
    climate: ClimateSummary
    soil: SoilInfo | None
    irrigated: bool

    @property
    def south(self) -> bool:
        return self.climate.southern_hemisphere

    @property
    def awc(self) -> float:
        if self.soil and self.soil.available_water_cm_per_cm is not None:
            return self.soil.available_water_cm_per_cm
        return ASSUMED_AWC

    def season_et0(self, crop: Crop) -> float:
        return sum(
            self.climate.monthly_et0_mm[m - 1] for m in _months(crop.season_months, self.south)
        )

    def season_rain(self, crop: Crop) -> float:
        return sum(
            self.climate.monthly_precip_mm[m - 1] for m in _months(crop.season_months, self.south)
        )

    def soil_storage_mm(self, crop: Crop) -> float:
        """Plant-available water the soil holds within the crop's root depth, mm: each
        layer's available water (cm per cm of soil) x its thickness above the root depth.
        A soil shallower than the roots holds only what its layers hold. Without layers
        (top layer only), the top layer's value is used for the whole depth."""
        depth_cm = crop.root_depth_m * 100
        if self.soil and self.soil.horizons:
            return 10 * sum(
                awc * max(0.0, min(bottom, depth_cm) - top)
                for top, bottom, awc in self.soil.horizons
            )
        return self.awc * depth_cm * 10

    def year(self, year: RotationYear) -> YearMetrics:
        crop = CROPS[year.crop]
        cover = year.cover and crop.cover_crop_ok
        crop_season = _months(crop.season_months, self.south)
        demand = crop.kc_season * self.season_et0(crop)
        supply = self.season_rain(crop) + self.soil_storage_mm(crop)
        covered = _months(crop.cover_months, self.south)
        if cover:
            rye_only_season = _months(COVER_RYE.season_months, self.south) - crop_season
            demand += COVER_RYE.kc_season * sum(
                self.climate.monthly_et0_mm[m - 1] for m in rye_only_season
            )
            covered |= _months(COVER_RYE.cover_months, self.south)
        return YearMetrics(crop, cover, demand, supply, frozenset(covered))

    def month_weights(self) -> list[float]:
        """Share of erosion-driving rain in each month: half total rain, half heavy-rain days."""
        rain = self.climate.monthly_precip_mm
        heavy = self.climate.monthly_heavy_rain_days
        rain_total = sum(rain) or 1.0
        heavy_total = sum(heavy)
        if heavy_total == 0:
            return [r / rain_total for r in rain]
        return [
            0.5 * r / rain_total + 0.5 * h / heavy_total for r, h in zip(rain, heavy, strict=True)
        ]


@dataclass(frozen=True)
class Evaluation:
    years: list[RotationYear]
    metrics: list[YearMetrics]
    scores: dict[Criterion, float]
    violations: list[str]
    families: int

    @property
    def demand_mm(self) -> float:
        return sum(m.demand_mm for m in self.metrics) / len(self.metrics)

    @property
    def shortfall_mm(self) -> float:
        return sum(max(0.0, m.demand_mm - m.supply_mm) for m in self.metrics) / len(self.metrics)

    @property
    def cover_months(self) -> float:
        return sum(len(m.covered_months) for m in self.metrics) / len(self.metrics)

    @property
    def legume_years(self) -> int:
        return sum(m.crop.nitrogen_fixing for m in self.metrics)


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def evaluate(years: list[RotationYear], site: Site) -> Evaluation:
    metrics = [site.year(y) for y in years]
    crops = [m.crop for m in metrics]
    n = len(metrics)

    frost_free = site.climate.frost_free_days
    violations: list[str] = [
        f"{crop.name} needs about {crop.min_frost_free_days} frost-free days. This area "
        f"has a median of {frost_free}."
        for crop in dict.fromkeys(crops)
        if crop.frost_sensitive and frost_free < crop.min_frost_free_days
    ]
    if not site.irrigated:
        for m in metrics:
            if m.crop.key == "fallow" or m.demand_mm == 0:
                continue
            ratio = m.supply_mm / m.demand_mm
            if ratio < RAINFED_MIN_RATIO:
                msg = (
                    f"Without irrigation, rain plus stored soil water covers only "
                    f"{ratio:.0%} of what {m.crop.name.lower()} uses in a typical year."
                )
                if msg not in violations:
                    violations.append(msg)

    annual_et0 = site.climate.annual_et0_mm or 1.0
    demand = sum(m.demand_mm for m in metrics) / n
    water = _clamp(1 - demand / annual_et0)

    # Organic-matter gain: living cover and deep roots add carbon. Nitrogen fixing is
    # its own criterion, so legumes are not counted twice.
    cover_share = sum(len(m.covered_months) for m in metrics) / (12 * n)
    deep_share = sum(c.root_depth_m >= 1.2 for c in crops) / n
    soil = _clamp(0.5 * cover_share + 0.5 * deep_share)
    nitrogen = sum(c.nitrogen_fixing for c in crops) / n
    forage = sum(FORAGE_SCORE[c.forage] for c in crops) / n

    weights = site.month_weights()
    exposure = (
        sum(
            sum(w for month, w in enumerate(weights, start=1) if month not in m.covered_months)
            for m in metrics
        )
        / n
    )
    susceptibility = SUSCEPTIBILITY_FACTOR[erosion_susceptibility(site.soil)]
    erosion = _clamp(1 - exposure * susceptibility)

    families = {c.family for c in crops if c.family != "none"}
    pests = _clamp((len(families) - 1) / 2)
    if any(c.key == "fallow" for c in crops):  # a year with no host crop also breaks cycles
        pests = _clamp(pests + 0.25)
    repeats = n > 1 and any(
        crops[i].key == crops[(i + 1) % n].key
        and not crops[i].perennial
        and crops[i].key != "fallow"
        for i in range(n)
    )
    same_family_adjacent = (
        n > 2
        and len(families) >= 2
        and any(
            crops[i].family == crops[(i + 1) % n].family
            and crops[i].family != "none"
            and not crops[i].perennial
            for i in range(n)
        )
    )
    canola_overused = sum(c.key == "canola" for c in crops) / n > (1 / 3 + 1e-9)
    if repeats:  # the same annual crop back to back (e.g. corn on corn) feeds its pests
        pests *= 0.5
    elif same_family_adjacent or canola_overused:
        pests = _clamp(pests - 0.15)

    year_incomes: list[float] = []
    for m in metrics:
        inc = MARKET_SCORE[m.crop.market]
        if not site.irrigated and m.demand_mm > 0 and m.supply_mm < m.demand_mm:
            inc *= m.supply_mm / m.demand_mm
        if m.crop.heat_sensitive and site.climate.heat_days_per_year >= 5:
            inc *= 0.9
        year_incomes.append(inc)
    income = _clamp(sum(year_incomes) / n)

    return Evaluation(
        years=years,
        metrics=metrics,
        scores={
            "water": water,
            "soil": soil,
            "nitrogen": nitrogen,
            "erosion": erosion,
            "pests": pests,
            "forage": forage,
            "income": income,
        },
        violations=violations,
        families=len(families),
    )


# ------------------------------------------------------------------------------ text


def rotation_name(years: list[RotationYear]) -> str:
    parts: list[str] = []
    i = 0
    while i < len(years):
        y = years[i]
        crop = CROPS[y.crop]
        run = 1
        while (
            crop.perennial
            and i + run < len(years)
            and years[i + run].crop == y.crop
            and not years[i + run].cover
        ):
            run += 1
        label = crop.name.replace(" (grain)", "")
        if run > 1:
            label += f" ({run} yrs)"
        if y.cover and crop.cover_crop_ok:
            label += " + rye cover"
        parts.append(label)
        i += run
    return " – ".join(parts)


def _place(climate: ClimateSummary) -> str:
    return "NASA POWER grid cell (about 50 km) around the field"


def _period(climate: ClimateSummary) -> str:
    return f"{climate.start_year}–{climate.end_year}"


def _evidence(ev: Evaluation, site: Site) -> list[Evidence]:
    c = site.climate
    items: list[Evidence] = []
    if any(m.crop.frost_sensitive for m in ev.metrics):
        items.append(
            Evidence(
                dataset="NASA POWER",
                variable="Frost-free season (median)",
                value=f"{c.frost_free_days} days",
                period=_period(c),
                place=_place(c),
                support="regional",
                url=power.HOME_URL,
            )
        )
    for crop in dict.fromkeys(m.crop for m in ev.metrics):
        if crop.key == "fallow":
            continue
        months = _months(crop.season_months, site.south)
        items.append(
            Evidence(
                dataset="NASA POWER + FAO-56",
                variable=f"{crop.name}: rain vs crop water use, {_month_range(months)}",
                value=f"{site.season_rain(crop):.0f} mm rain vs about "
                f"{crop.kc_season * site.season_et0(crop):.0f} mm use",
                period=_period(c),
                place=_place(c),
                support="regional",
                url=power.HOME_URL,
            )
        )
    weights = site.month_weights()
    wettest = sorted(range(12), key=lambda i: weights[i], reverse=True)[:3]
    items.append(
        Evidence(
            dataset="NASA POWER",
            variable="Months with the most erosion-driving rain",
            value=", ".join(MONTHS[i] for i in sorted(wettest)),
            period=_period(c),
            place=_place(c),
            support="regional",
            url=power.HOME_URL,
        )
    )
    if site.soil:
        s = site.soil
        soil_bits = []
        if s.organic_matter_percent is not None:
            soil_bits.append(f"organic matter {s.organic_matter_percent:g}%")
        if s.available_water_cm_per_cm is not None:
            soil_bits.append(f"water-holding {s.available_water_cm_per_cm:g} cm/cm")
        if s.slope_percent is not None:
            soil_bits.append(f"slope {s.slope_percent:g}%")
        items.append(
            Evidence(
                dataset=s.dataset,
                variable=f"Soil: {s.component}",
                value=", ".join(soil_bits) or "mapped, no properties listed",
                period=s.period,
                place=s.place,
                support="field-level",
                url=s.url,
            )
        )
    items.append(
        Evidence(
            dataset="FAO-56 (Allen et al., 1998)",
            variable="Crop water-use coefficients and root depths",
            value="general values for each crop",
            period="—",
            place="general",
            support="general reference",
            url=FAO56_URL,
        )
    )
    return items


def _gaps(site: Site) -> list[str]:
    gaps = [
        "Bare-soil months come from typical crop calendars, not yet from satellite "
        "observations of this field.",
        "Crop water use uses general crop coefficients (FAO-56). Local varieties and "
        "planting dates change it.",
        "Market suitability uses a general market class, not your local buyers.",
        "Weather comes from a NASA POWER grid cell about 50 km across. Your field's own "
        "microclimate can differ.",
    ]
    if site.soil is None:
        gaps.insert(
            0,
            "No soil data here (we read soil maps for the U.S. and Canada only). Soil "
            "water storage assumes a typical loam. A soil test would replace this.",
        )
    elif site.soil.slope_percent is None:
        gaps.insert(
            0,
            "The soil data here has no slope, drainage or erodibility, so erosion risk "
            "from the field's own slope is unknown. Soil texture and organic matter come "
            f"from a modelled map ({site.soil.dataset}). A soil test would confirm them.",
        )
    return gaps


def _improvement(criterion: Criterion, ev: Evaluation, base: Evaluation) -> str:
    match criterion:
        case "water":
            return (
                f"Uses less water: about {ev.demand_mm:.0f} mm a year instead of "
                f"{base.demand_mm:.0f} mm."
            )
        case "soil":
            return (
                f"Adds organic matter: about {_months_str(ev.cover_months)} months of living cover "
                f"a year (now {_months_str(base.cover_months)}), and more deep-rooted years."
            )
        case "nitrogen":
            return (
                f"Fixes more nitrogen: {ev.legume_years} of {len(ev.years)} years with a "
                f"legume (now {base.legume_years} of {len(base.years)})."
            )
        case "forage":
            return "Grows more feed for livestock (hay, grazing or silage)."
        case "erosion":
            return (
                f"Keeps the soil covered for about {_months_str(ev.cover_months)} months a year "
                f"instead of {_months_str(base.cover_months)}, including more of the heavy-rain "
                "months."
            )
        case "pests":
            return (
                f"Breaks pest and disease cycles better: {ev.families} crop families "
                f"instead of {base.families}."
            )
        case "income":
            return "Keeps more years in crops with strong general markets."


def _tradeoff(criterion: Criterion, ev: Evaluation, base: Evaluation) -> str:
    match criterion:
        case "water":
            return (
                f"It uses more water than your current rotation: about {ev.demand_mm:.0f} mm "
                f"a year instead of {base.demand_mm:.0f} mm."
            )
        case "soil":
            return "It adds less organic matter than your current rotation."
        case "nitrogen":
            return (
                f"It has fewer legume years ({ev.legume_years} of {len(ev.years)}), so the "
                "next crops may need more nitrogen fertilizer."
            )
        case "forage":
            return "It grows less feed for livestock than your current rotation."
        case "erosion":
            return (
                f"It leaves the soil bare for longer: about {_months_str(12 - ev.cover_months)} "
                f"bare months a year instead of {_months_str(12 - base.cover_months)}."
            )
        case "pests":
            return "It breaks pest cycles less well than your current rotation."
        case "income":
            return "It may earn less, because more years are in crops with smaller markets."


def _local_review(ev: Evaluation, base: Evaluation | None, site: Site) -> list[str]:
    notes: list[str] = []
    crops = list(dict.fromkeys(m.crop for m in ev.metrics))
    base_keys = {m.crop.key for m in base.metrics} if base else set()
    for crop in crops:
        if crop.key in CROP_RISKS:
            notes.append(CROP_RISKS[crop.key])
        if crop.heat_sensitive and site.climate.heat_days_per_year >= 5:
            notes.append(
                f"This area averages {_days(site.climate.heat_days_per_year)} a year at "
                f"35 °C or more, and {crop.name.lower()} can lose yield in the heat."
            )
    new = [c.name.lower() for c in crops if base and c.key not in base_keys and c.key != "fallow"]
    if new:
        notes.append(f"New crops ({', '.join(new)}) may need different equipment, seed or buyers.")
    if any(m.cover for m in ev.metrics):
        notes.append(COVER_RISK)
    if ev.legume_years and any(m.crop.key == "corn" for m in ev.metrics):
        notes.append(
            "The nitrogen a legume leaves for the next crop depends on the stand and "
            "management. Confirm with a soil test before cutting fertilizer."
        )
    if not site.irrigated and ev.shortfall_mm > 0:
        notes.append(
            f"In a typical year rain and stored soil water fall about "
            f"{ev.shortfall_mm:.0f} mm short of crop use. Dry years will cut yields."
        )
    notes.append(
        "Local pests and diseases decide how much a rotation helps. Check with your "
        "local extension advisor."
    )
    return notes


# -------------------------------------------------------------------------- calendar
# Month-by-month view of a rotation for the 3D season view. Display only: scores above
# use the per-year metrics, so the two can differ by a month where crops replace each
# other (a winter wheat sown where a cover crop would have gone).


def _ordered(months: Sequence[int]) -> list[int]:
    """A season's months in growing order, also when it wraps the year end (Oct..Jun)."""
    ms = sorted(set(months))
    for i, m in enumerate(ms):
        if (m - 2) % 12 + 1 not in ms:  # the month before is not in the season: start here
            return ms[i:] + ms[:i]
    return ms


def _growth(crop: Crop) -> dict[int, float]:
    """Growth stage (0..1) in each of a crop's cover months (northern calendar)."""
    if crop.is_cover:
        return dict.fromkeys(crop.cover_months, 0.35)
    growth = dict.fromkeys(crop.cover_months, 0.3)  # months outside the season: dormant
    active = [m for m in _ordered(crop.cover_months) if m in crop.season_months]
    if crop.perennial:
        growth.update(dict.fromkeys(active, 0.8))
        return growth
    peak = max(1, round(0.6 * len(active)))
    for k, m in enumerate(active):
        growth[m] = min(1.0, (k + 1) / peak)
    return growth


def _bare() -> MonthState:
    return MonthState(state="bare", crop=None, growth=0.0, water_mm=0.0)


def _year_states(year: RotationYear, site: Site) -> dict[int, MonthState]:
    crop = CROPS[year.crop]
    growth = _growth(crop)
    states: dict[int, MonthState] = {}
    for m in range(1, 13):
        et0 = site.climate.monthly_et0_mm[_shift(m, site.south) - 1]
        water = round(crop.kc_season * et0, 1) if m in crop.season_months else 0.0
        if m in crop.cover_months:
            states[m] = MonthState(state="crop", crop=crop.key, growth=growth[m], water_mm=water)
        elif m in crop.season_months:
            states[m] = MonthState(state="planted", crop=crop.key, growth=0.1, water_mm=water)
        else:
            states[m] = _bare()
    return states


def _is_winter_crop(crop: Crop) -> bool:
    return any(m >= 8 for m in crop.season_months) and any(m <= 6 for m in crop.season_months)


def build_calendar(years: list[RotationYear], site: Site) -> list[list[MonthState]]:
    """Twelve calendar months (Jan..Dec) per rotation year, as the field would look.

    Winter crops are sown in the autumn of the year before their harvest, and a winter
    cover crop sown after harvest stays into the next spring, so those months move to
    the neighbouring rotation year when it is bare then.
    """
    n = len(years)
    cal = [_year_states(y, site) for y in years]
    for i, y in enumerate(years):
        crop = CROPS[y.crop]
        if n == 1 or crop.perennial or not _is_winter_crop(crop):
            continue
        before = cal[(i - 1) % n]
        for m in range(8, 13):
            if cal[i][m].state != "bare" and before[m].state == "bare":
                before[m], cal[i][m] = cal[i][m], _bare()
    rye_growth = _growth(COVER_RYE)
    for i, y in enumerate(years):
        if not (y.cover and CROPS[y.crop].cover_crop_ok):
            continue
        for m in COVER_RYE.cover_months:
            target = cal[i] if m >= 8 else cal[(i + 1) % n]
            if target[m].state != "bare":
                continue
            et0 = site.climate.monthly_et0_mm[_shift(m, site.south) - 1]
            water = round(COVER_RYE.kc_season * et0, 1) if m in COVER_RYE.season_months else 0.0
            target[m] = MonthState(
                state="cover", crop=COVER_RYE.key, growth=rye_growth[m], water_mm=water
            )
    # Northern-calendar month m shows in calendar month _shift(m); the shift is its own inverse.
    return [[year[_shift(c, site.south)] for c in range(1, 13)] for year in cal]


def frost_months(climate: ClimateSummary) -> list[bool]:
    """Calendar months in which frost is usual: outside the median frost-free season."""
    if not (climate.last_spring_frost and climate.first_fall_frost):
        return [False] * 12
    spring = int(climate.last_spring_frost[:2])
    fall = int(climate.first_fall_frost[:2])
    if spring < fall:  # northern pattern: frost from autumn through spring
        return [m <= spring or m >= fall for m in range(1, 13)]
    return [fall <= m <= spring for m in range(1, 13)]


# ---------------------------------------------------------------------------- engine


def _total(scores: dict[Criterion, float], weights: dict[Criterion, int]) -> float:
    weight_sum = sum(weights.values())
    if weight_sum == 0:
        return sum(scores.values()) / len(scores)
    return sum(scores[c] * weights[c] for c in CRITERIA) / weight_sum


def _candidates(baseline: list[RotationYear]) -> list[tuple[str, list[RotationYear]]]:
    out = [(tid, [RotationYear(crop=c, cover=cov) for c, cov in years]) for tid, years in TEMPLATES]
    with_cover = [
        RotationYear(crop=y.crop, cover=y.cover or CROPS[y.crop].cover_crop_ok) for y in baseline
    ]
    if with_cover != baseline:
        out.insert(0, ("current-plus-cover", with_cover))
    return out


def _valid_transitions(years: list[RotationYear]) -> bool:
    """Reject agronomically broken sequences such as winter wheat after an October-occupied crop."""
    n = len(years)
    if n <= 1:
        return True
    for i, y in enumerate(years):
        crop = CROPS[y.crop]
        prev = CROPS[years[(i - 1) % n].crop]
        nxt = CROPS[years[(i + 1) % n].crop]
        if crop.key == "winter_wheat" and 10 in prev.season_months:
            return False
        if crop.perennial and prev.key != crop.key and nxt.key != crop.key:
            return False
    return True


def _mutations(baseline: list[RotationYear]) -> list[tuple[str, list[RotationYear]]]:
    """Generate pragmatic 1-step adaptations tailored to the farmer's current rotation."""
    out: list[tuple[str, list[RotationYear]]] = []
    n = len(baseline)

    def add(sid: str, yrs: list[RotationYear]) -> None:
        if not _valid_transitions(yrs):
            return
        out.append((sid, yrs))
        cov = [RotationYear(crop=y.crop, cover=y.cover or CROPS[y.crop].cover_crop_ok) for y in yrs]
        if cov != yrs:
            out.append((f"{sid}-cover", cov))

    if n == 1 and baseline[0].crop != "fallow":
        y0 = baseline[0]
        for alt in ("soybean", "field_pea", "winter_wheat", "canola", "sorghum", "corn"):
            if alt != y0.crop:
                add(
                    f"pair-{alt}",
                    [y0, RotationYear(crop=alt, cover=y0.cover and CROPS[alt].cover_crop_ok)],
                )

    if n >= 2:
        for i in range(n):
            c_curr = CROPS[baseline[i].crop]
            c_next = CROPS[baseline[(i + 1) % n].crop]
            if c_curr.key == c_next.key and not c_curr.perennial and c_curr.key != "fallow":
                for alt in ("soybean", "field_pea", "winter_wheat", "canola", "sorghum", "oats"):
                    if alt != c_curr.key:
                        replaced = list(baseline)
                        replaced[(i + 1) % n] = RotationYear(
                            crop=alt,
                            cover=baseline[(i + 1) % n].cover and CROPS[alt].cover_crop_ok,
                        )
                        add(f"break-repeat-{alt}", replaced)
                break

    if 1 <= n <= 3 and any(y.crop != "fallow" for y in baseline):
        families = {CROPS[y.crop].family for y in baseline if CROPS[y.crop].family != "none"}
        existing_keys = {y.crop for y in baseline}
        any_cover = any(y.cover for y in baseline)
        ext_keys: list[str] = []
        if "legume" not in families:
            ext_keys.extend(["soybean", "field_pea"])
        if "brassica" not in families:
            ext_keys.append("canola")
        if "grass" not in families:
            ext_keys.extend(["winter_wheat", "corn", "spring_wheat", "sorghum", "oats"])
        if "winter_wheat" not in existing_keys and "winter_wheat" not in ext_keys:
            ext_keys.append("winter_wheat")
        for key in ext_keys:
            if key not in existing_keys:
                add(
                    f"extend-{key}",
                    [
                        *baseline,
                        RotationYear(crop=key, cover=any_cover and CROPS[key].cover_crop_ok),
                    ],
                )

    for i, y in enumerate(baseline):
        swaps: tuple[str, ...] = ()
        if y.crop == "corn":
            swaps = ("sorghum",)
        elif y.crop in ("spring_wheat", "barley", "oats"):
            swaps = ("winter_wheat", "field_pea")
        for alt in swaps:
            if alt != y.crop:
                swapped = list(baseline)
                swapped[i] = RotationYear(crop=alt, cover=y.cover and CROPS[alt].cover_crop_ok)
                add(f"swap-{y.crop}-{alt}", swapped)

    return out


def _short_name(crop: Crop) -> str:
    return crop.name.replace(" (grain)", "").lower()


def _same_cycle(a: Sequence[object], b: Sequence[object]) -> bool:
    """Equal up to where the cyclic sequence starts."""
    return len(a) == len(b) and any(list(a[i:]) + list(a[:i]) == list(b) for i in range(len(a)))


def _change_lead(years: list[RotationYear], baseline: list[RotationYear]) -> str | None:
    """Describe a direct 1-step edit from the farmer's rotation when one applies."""
    base_crops = [y.crop for y in baseline]
    cand_crops = [y.crop for y in years]
    added_cover = any(y.cover for y in years) and not any(y.cover for y in baseline)
    cover_note = " with winter rye cover" if added_cover else ""

    if cand_crops == base_crops:
        if any(y.cover and not b.cover for y, b in zip(years, baseline, strict=True)):
            return "Adds winter rye cover to your current rotation."
        return None

    if len(years) == len(baseline):
        diffs = [i for i in range(len(years)) if cand_crops[i] != base_crops[i]]
        if len(diffs) == 1:
            idx = diffs[0]
            old_crop = CROPS[base_crops[idx]]
            new_crop = CROPS[cand_crops[idx]]
            n = len(baseline)
            had_repeat = (
                n > 1
                and not old_crop.perennial
                and old_crop.key != "fallow"
                and any(base_crops[k] == base_crops[(k + 1) % n] == old_crop.key for k in range(n))
            )
            if had_repeat:
                return (
                    f"Replaces a repeated {_short_name(old_crop)} year with "
                    f"{_short_name(new_crop)}{cover_note}."
                )
            return f"Swaps {_short_name(old_crop)} for {_short_name(new_crop)}{cover_note}."

    if len(years) == len(baseline) + 1:
        for k in range(len(years)):
            if _same_cycle(cand_crops[:k] + cand_crops[k + 1 :], base_crops):
                added = CROPS[cand_crops[k]]
                return (
                    f"Keeps your current crops and adds a year of {_short_name(added)}{cover_note}."
                )

    return None


def _pick_alternatives(
    feasible: list[tuple[str, Evaluation]],
    baseline: list[RotationYear],
    weights: dict[Criterion, int],
) -> list[tuple[str, Evaluation]]:
    """Select up to MAX_ALTERNATIVES distinct, well-rounded options, sorted by score."""
    if len(feasible) <= MAX_ALTERNATIVES:
        return feasible

    deduped: list[tuple[str, Evaluation]] = []
    seen_sets: set[frozenset[str]] = set()
    cover_added = False
    for sid, ev in feasible:
        if sid == "current-plus-cover":
            if not cover_added:
                deduped.append((sid, ev))
                cover_added = True
            continue
        cset = frozenset(y.crop for y in ev.years)
        if cset in seen_sets:
            continue
        seen_sets.add(cset)
        deduped.append((sid, ev))

    if len(deduped) <= MAX_ALTERNATIVES:
        return deduped

    bset = frozenset(y.crop for y in baseline if y.crop != "fallow")

    def is_close(ev: Evaluation) -> bool:
        if not bset:
            return False
        cset = frozenset(y.crop for y in ev.years if y.crop != "fallow")
        return bset.issubset(cset) and len(ev.years) <= len(baseline) + 1

    chosen: list[tuple[str, Evaluation]] = [deduped[0]]
    if not is_close(deduped[0][1]):
        close_opt = next(((s, e) for s, e in deduped[1:] if is_close(e)), None)
        if close_opt:
            chosen.append(close_opt)

    if not any(e.families >= 3 or any(m.crop.perennial for m in e.metrics) for _, e in chosen):
        diverse_opt = next(
            (
                (s, e)
                for s, e in deduped[1:]
                if (s, e) not in chosen
                and (e.families >= 3 or any(m.crop.perennial for m in e.metrics))
            ),
            None,
        )
        if diverse_opt and len(chosen) < MAX_ALTERNATIVES:
            chosen.append(diverse_opt)

    for item in deduped[1:]:
        if len(chosen) >= MAX_ALTERNATIVES:
            break
        if item not in chosen:
            chosen.append(item)

    chosen.sort(key=lambda item: _total(item[1].scores, weights), reverse=True)
    return chosen


def _same_rotation(a: list[RotationYear], b: list[RotationYear]) -> bool:
    """Equal up to where the cycle starts: corn-soy is the same rotation as soy-corn."""
    return _same_cycle(a, b)


def _strategy(
    sid: str,
    ev: Evaluation,
    base: Evaluation | None,
    site: Site,
    weights: dict[Criterion, int],
) -> Strategy:
    is_baseline = base is None
    total = _total(ev.scores, weights)
    if is_baseline:
        why = ["This is your current rotation. The other options are compared with it."]
        benefits = [
            f"You already know how to grow it, and it gives about {_months_str(ev.cover_months)} "
            f"months of living cover a year."
        ]
        tradeoffs: list[str] = []
    else:
        gains = sorted(
            (c for c in CRITERIA if ev.scores[c] - base.scores[c] > 0.05),
            key=lambda c: weights[c] * (ev.scores[c] - base.scores[c]),
            reverse=True,
        )
        top = [c for c in gains if weights[c] > 0][:2]
        if top:
            why = [
                f"Suggested because you care about "
                f"{' and '.join(CRITERION_LABEL[c] for c in top)}, "
                f"and it scores better there than your current rotation."
            ]
        else:
            why = [
                "Suggested as a different direction. It does not beat your current rotation on "
                "the goals you rated highest."
            ]
        lead = _change_lead(ev.years, base.years)
        if lead:
            why = [f"{lead} {why[0]}"]
        benefits = [_improvement(c, ev, base) for c in gains]
        tradeoffs = [
            _tradeoff(c, ev, base)
            for c in CRITERIA
            if base.scores[c] - ev.scores[c] > 0.05 and weights[c] > 0
        ]
    return Strategy(
        id=sid,
        name=rotation_name(ev.years),
        years=ev.years,
        is_baseline=is_baseline,
        scores={c: round(ev.scores[c], 3) for c in CRITERIA},
        total=round(total, 3),
        why=why,
        evidence=_evidence(ev, site),
        benefits=benefits or ["No clear gain over your current rotation on these measures."],
        gaps=_gaps(site),
        local_review=tradeoffs + _local_review(ev, base, site),
        water_demand_mm=round(ev.demand_mm),
        rainfed_shortfall_mm=round(ev.shortfall_mm),
        cover_months=round(ev.cover_months, 1),
        warnings=ev.violations if is_baseline else [],
        calendar=build_calendar(ev.years, site),
    )


def _days(value: float) -> str:
    n = round(value)
    return f"{n} day" if n == 1 else f"{n} days"


def _verb(count: float, verb: str) -> str:
    """Agree a verb with a day count: "1 day brings", "5 days bring"."""
    return (
        f"{verb}es"
        if round(count) == 1 and verb.endswith(("ch", "sh"))
        else (f"{verb}s" if round(count) == 1 else verb)
    )


def erosion_susceptibility(soil: SoilInfo | None) -> str:
    if soil is None or soil.slope_percent is None:
        return "unknown"
    k = soil.erodibility_k or 0.0
    if soil.slope_percent >= 8 or (soil.slope_percent >= 4 and k >= 0.37):
        return "high"
    if soil.slope_percent >= 3 or k >= 0.32:
        return "moderate"
    return "low"


def conditions(climate: ClimateSummary, soil: SoilInfo | None) -> Conditions:
    c = climate
    summary = [
        f"From {c.start_year} to {c.end_year}, this area got about {c.annual_precip_mm:.0f} mm of "
        f"rain a year. The air could have taken up about {c.annual_et0_mm:.0f} mm "
        "(reference evapotranspiration: the water a well-watered grass field would lose)."
    ]
    deficit = {i: c.monthly_et0_mm[i] - c.monthly_precip_mm[i] for i in range(12)}
    dry = {i + 1 for i, d in deficit.items() if d > 10}
    if dry:
        summary.append(f"In {_month_range(dry)}, crops usually need more water than rain gives.")
    if c.last_spring_frost and c.first_fall_frost:

        def fmt(mmdd: str) -> str:
            return f"{MONTHS[int(mmdd[:2]) - 1]} {int(mmdd[3:])}"

        summary.append(
            f"The last spring frost is usually around {fmt(c.last_spring_frost)} and the first "
            f"fall frost around {fmt(c.first_fall_frost)}: "
            f"about {c.frost_free_days} frost-free days."
        )
    else:
        summary.append("Frost is rare here.")
    if (heavy := c.heavy_rain_days_per_year) >= 0.5:
        top = sorted(range(12), key=lambda i: c.monthly_heavy_rain_days[i], reverse=True)[:2]
        summary.append(
            f"About {_days(heavy)} a year {_verb(heavy, 'bring')} heavy rain (25 mm or more), "
            f"most often in {' and '.join(MONTHS[i] for i in sorted(top))}."
        )
    if (heat := c.heat_days_per_year) >= 1:
        summary.append(f"About {_days(heat)} a year {_verb(heat, 'reach')} 35 °C or more.")
    if c.recent_precip_change_percent is not None and c.recent_tmax_change_c is not None:
        wet = "wetter" if c.recent_precip_change_percent >= 0 else "drier"
        warm = "warmer" if c.recent_tmax_change_c >= 0 else "cooler"
        summary.append(
            f"The last 10 years were {abs(c.recent_precip_change_percent):.0f}% {wet}, with daily "
            f"highs {abs(c.recent_tmax_change_c):.1f} °C {warm}, than the 10 years before."
        )
    if soil:
        bits = [f"Soil: {soil.component} ({soil.map_unit})"]
        if soil.organic_matter_percent is not None:
            bits.append(f"about {soil.organic_matter_percent:g}% organic matter")
        if soil.slope_percent is not None:
            bits.append(f"slope about {soil.slope_percent:g}%")
        summary.append(", ".join(bits) + ".")
    else:
        summary.append("No soil data for this point (we read soil maps for the U.S. and Canada).")

    return Conditions(
        period=f"{c.start_year}–{c.end_year}",
        annual_precip_mm=round(c.annual_precip_mm),
        annual_et0_mm=round(c.annual_et0_mm),
        monthly_precip_mm=[round(v, 1) for v in c.monthly_precip_mm],
        monthly_et0_mm=[round(v, 1) for v in c.monthly_et0_mm],
        monthly_heavy_rain_days=[round(v, 2) for v in c.monthly_heavy_rain_days],
        monthly_heat_days=[round(v, 2) for v in c.monthly_heat_days],
        frost_months=frost_months(c),
        last_spring_frost=c.last_spring_frost,
        first_fall_frost=c.first_fall_frost,
        frost_free_days=c.frost_free_days,
        heat_days_per_year=round(c.heat_days_per_year, 1),
        heavy_rain_days_per_year=round(c.heavy_rain_days_per_year, 1),
        recent_precip_change_percent=(
            None
            if c.recent_precip_change_percent is None
            else round(c.recent_precip_change_percent, 1)
        ),
        recent_tmax_change_c=None
        if c.recent_tmax_change_c is None
        else round(c.recent_tmax_change_c, 2),
        soil=None if soil is None else Soil(**{k: getattr(soil, k) for k in Soil.model_fields}),
        erosion_susceptibility=erosion_susceptibility(soil),
        summary=summary,
    )


def analyze(
    request: AnalyzeRequest, climate: ClimateSummary, soil: SoilInfo | None
) -> AnalyzeResponse:
    """Compare the farmer's current rotation with the best feasible alternatives."""
    unknown = [y.crop for y in request.current_rotation if y.crop not in CROPS]
    unknown += [c for c in request.excluded_crops if c not in CROPS]
    if unknown:
        raise ValueError(f"unknown crops: {', '.join(unknown)}")
    site = Site(climate=climate, soil=soil, irrigated=request.irrigated)
    weights: dict[Criterion, int] = request.priorities.model_dump()
    baseline_years = [
        RotationYear(crop=y.crop, cover=y.cover and CROPS[y.crop].cover_crop_ok)
        for y in request.current_rotation
    ]
    base = evaluate(baseline_years, site)

    feasible: list[tuple[str, Evaluation]] = []
    removed: list[RemovedStrategy] = []
    seen: list[list[RotationYear]] = [baseline_years]
    for is_template, pool in (
        (True, _candidates(baseline_years)),
        (False, _mutations(baseline_years)),
    ):
        for sid, years in pool:
            if any(_same_rotation(years, other) for other in seen):
                continue
            seen.append(years)
            ev = evaluate(years, site)
            excluded = [
                f"You said you can't grow or sell {CROPS[key].name.lower()} here."
                for key in dict.fromkeys(y.crop for y in years)
                if key in request.excluded_crops
            ]
            if excluded or ev.violations:
                if is_template:
                    removed.append(
                        RemovedStrategy(
                            name=rotation_name(years), reason=" ".join(excluded + ev.violations)
                        )
                    )
            else:
                feasible.append((sid, ev))
    feasible.sort(key=lambda item: _total(item[1].scores, weights), reverse=True)
    picked = _pick_alternatives(feasible, baseline_years, weights)

    strategies = [_strategy("current", base, None, site, weights)]
    strategies += [_strategy(sid, ev, base, site, weights) for sid, ev in picked]

    notes = [
        "This tool suggests options to explore. It does not decide for you: check any change "
        "with your local extension advisor or agronomist.",
    ]
    if len(strategies) < 3:
        notes.append(
            "Fewer than two alternatives passed the checks for this field (see the "
            "removed options and their reasons)."
        )
    return AnalyzeResponse(
        latitude=request.latitude,
        longitude=request.longitude,
        conditions=conditions(climate, soil),
        strategies=strategies,
        removed=removed,
        weights=weights,
        notes=notes,
    )
