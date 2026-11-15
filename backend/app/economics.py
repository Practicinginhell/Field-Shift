"""Gross margin of each rotation, per acre a year, from published regional budgets.

Gross margin = yield x price - costs, for each year of the rotation, minus the cost of a
winter rye cover crop in the years that have one, averaged over the rotation's years.
Costs leave out land (and, for Iowa, labour and machinery ownership), so this is not
profit: it compares rotations on the same field, which is what the farmer decides.

Regional numbers are used only where a current published budget exists. Elsewhere, or
for a crop the budget doesn't cover, the margin is left empty and the farmer can enter
their own yield, price and cost, which always replace the budget.
"""

from dataclasses import dataclass

from pydantic import BaseModel

from app.crops import CROPS
from app.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    CropLine,
    CropNumbers,
    Economics,
    Margin,
    RotationYear,
)

COVER_NAME = "Winter rye cover"


class BudgetLine(BaseModel):
    yield_per_acre: float
    unit: str
    price: float | None
    """None when there is no official price for the region (the farmer supplies one)."""
    cost_per_acre: float


@dataclass(frozen=True)
class Budget:
    region: str
    currency: str
    basis: str
    cover_crop_cost: float
    crops: dict[str, BudgetLine]
    sources: list[str]
    south: float
    north: float
    west: float
    east: float
    canada_only: bool
    """Skip points with a U.S. soil survey (the box crosses the border)."""


# Iowa State University Ag Decision Maker A1-20 (2026), middle yield level, variable
# costs; prices from USDA WASDE (10 Nov 2026) and NASS Agricultural Prices (Iowa
# alfalfa, Sept 2026). Rye cover: ISU 2026 custom rates for drilling ($19.05) and one
# ground spray pass ($8.50), plus 56 lb of cereal rye seed at about $0.25/lb ($14.00).
IOWA = Budget(
    region="Iowa",
    currency="USD",
    basis=(
        "Costs are the Iowa State budget's variable costs: seed, fertilizer, chemicals, "
        "crop insurance, fuel and repairs, drying and hauling, and interest. Land, labour "
        "and machinery ownership are not included."
    ),
    cover_crop_cost=19.05 + 8.50 + 14.00,
    crops={
        "corn": BudgetLine(yield_per_acre=211, unit="bu", price=4.60, cost_per_acre=483.60),
        "soybean": BudgetLine(yield_per_acre=61, unit="bu", price=12.10, cost_per_acre=290.21),
        "alfalfa": BudgetLine(yield_per_acre=4, unit="ton", price=142, cost_per_acre=242.56),
    },
    sources=[
        "Iowa State University Extension, Ag Decision Maker A1-20, Estimated Costs of Crop "
        "Production in Iowa 2026 (corn after soybeans, soybeans after corn, established "
        "alfalfa): https://www.extension.iastate.edu/agdm/crops/pdf/a1-20.pdf",
        "USDA World Agricultural Supply and Demand Estimates, 10 November 2026, 2026/27 "
        "season-average farm prices: https://www.usda.gov/oce/commodity/wasde/wasde1126.pdf",
        "USDA NASS Agricultural Prices, 30 October 2026, Iowa alfalfa hay price, September "
        "2026: https://esmis.nal.usda.gov/sites/default/release-files/796128/agpr1026.pdf",
        "Iowa State University, 2026 Iowa Farm Custom Rate Survey (A3-10), drilling cover crop "
        "seed and ground spraying: https://www.extension.iastate.edu/agdm/crops/pdf/a3-10.pdf",
    ],
    south=40.375,
    north=43.501,
    west=-96.639,
    east=-90.140,
    canada_only=False,
)

# OMAFA Publication 60, Field Crop Budgets 2026: yields and costs before land, from the
# crop comparison summary table (barley from its own budget, feed barley). Prices:
# Statistics Canada table 32-10-0077-01, Ontario, mean of October 2025 to September
# 2026, $/tonne. No official Ontario hay price, so alfalfa needs the farmer's price.
# Rye cover: OMAFA fall rye seed ($41.40/acre at 112 kg/ha, so $18.48 at 50 kg/ha),
# planting ($32.00) and one spray pass ($18.00) from the same publication.
ONTARIO = Budget(
    region="Ontario",
    currency="CAD",
    basis=(
        "Costs are the OMAFA budget's costs before land: seed, fertilizer, chemicals, "
        "machinery at custom rates, drying, insurance, interest and marketing. Land rent "
        "and farm overhead are not included."
    ),
    cover_crop_cost=18.48 + 32.00 + 18.00,
    crops={
        "corn": BudgetLine(yield_per_acre=4.90, unit="t", price=254, cost_per_acre=875.05),
        "soybean": BudgetLine(yield_per_acre=1.42, unit="t", price=576, cost_per_acre=421.85),
        "winter_wheat": BudgetLine(yield_per_acre=2.61, unit="t", price=280, cost_per_acre=555.50),
        "spring_wheat": BudgetLine(yield_per_acre=1.52, unit="t", price=280, cost_per_acre=521.05),
        "barley": BudgetLine(yield_per_acre=1.5, unit="t", price=280, cost_per_acre=408.60),
        "oats": BudgetLine(yield_per_acre=1.31, unit="t", price=311, cost_per_acre=490.40),
        "canola": BudgetLine(yield_per_acre=1.03, unit="t", price=661, cost_per_acre=651.60),
        "alfalfa": BudgetLine(yield_per_acre=4.0, unit="t", price=None, cost_per_acre=341.65),
    },
    sources=[
        "Ontario Ministry of Agriculture, Food and Agribusiness (OMAFA), Publication 60, "
        "Field Crop Budgets 2026: https://www.ontario.ca/files/2026-01/"
        "omafa-field-crop-budgets-pub-60-en-2026-01-14.pdf",
        "Statistics Canada, Table 32-10-0077-01, Farm product prices, Ontario, mean of "
        "October 2025 to September 2026: "
        "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3210007701",
    ],
    south=41.6,
    north=48.0,
    west=-83.6,
    east=-74.3,
    canada_only=True,
)

BUDGETS = (IOWA, ONTARIO)

NO_BUDGET_BASIS = (
    "There is no current published crop budget for this area. Enter your own yields, "
    "prices and costs to compare rotations by margin."
)


def budget_for(latitude: float, longitude: float, us_soil: bool) -> Budget | None:
    """The regional budget for a field, or None where there is no current one.

    `us_soil` is True when the U.S. soil survey (SSURGO) answered for the point, which
    keeps U.S. fields inside Ontario's box (Detroit, northern New York) out of it.
    """
    for b in BUDGETS:
        inside = b.south <= latitude <= b.north and b.west <= longitude <= b.east
        if inside and not (b.canada_only and us_soil):
            return b
    return None


def rotation_margin(
    years: list[RotationYear], numbers: dict[str, CropNumbers], cover_cost: float | None
) -> tuple[float | None, list[str]]:
    """Mean yearly gross margin per acre of a rotation, and the names of what's missing.

    Each year earns yield x price - cost of its crop, less `cover_cost` when it carries
    a winter cover crop. If any crop (or the cover cost) has no numbers, the margin is
    None and the missing items are named, in the order they first appear.
    """
    missing: list[str] = []
    total = 0.0
    for y in years:
        n = numbers.get(y.crop)
        if n is None:
            name = CROPS[y.crop].name
            if name not in missing:
                missing.append(name)
        else:
            total += n.yield_per_acre * n.price - n.cost_per_acre
        if y.cover:
            if cover_cost is None:
                if COVER_NAME not in missing:
                    missing.append(COVER_NAME)
            else:
                total -= cover_cost
    if missing:
        return None, missing
    return total / len(years), []


def _unit(crop: str, budget: Budget | None) -> str:
    if budget and crop in budget.crops:
        return budget.crops[crop].unit
    return "ton" if crop == "alfalfa" else "bu"


def add_margins(response: AnalyzeResponse, request: AnalyzeRequest, budget: Budget | None) -> None:
    """Set each strategy's margin and the response's economics, in place."""
    numbers: dict[str, CropNumbers] = {}
    if budget:
        for key, line in budget.crops.items():
            if line.price is not None:
                numbers[key] = CropNumbers(
                    yield_per_acre=line.yield_per_acre,
                    price=line.price,
                    cost_per_acre=line.cost_per_acre,
                )
    own = {k: v for k, v in request.own_numbers.items() if k in CROPS}
    numbers.update(own)
    cover_cost = (
        request.own_cover_cost
        if request.own_cover_cost is not None
        else (budget.cover_crop_cost if budget else None)
    )

    base_value: float | None = None
    for i, s in enumerate(response.strategies):
        value, missing = rotation_margin(s.years, numbers, cover_cost)
        if i == 0:
            base_value = value
        vs = None if value is None or base_value is None else round(value - base_value)
        s.margin = Margin(
            per_acre=None if value is None else round(value), vs_current=vs, missing=missing
        )

    shown = dict.fromkeys(y.crop for s in response.strategies for y in s.years)
    lines = []
    for key in shown:
        if key in numbers:
            n = numbers[key]
            y, p, c = n.yield_per_acre, n.price, n.cost_per_acre
        elif budget and key in budget.crops:
            line = budget.crops[key]
            y, p, c = line.yield_per_acre, line.price, line.cost_per_acre
        else:
            y = p = c = None
        lines.append(
            CropLine(
                crop=key,
                name=CROPS[key].name,
                unit=_unit(key, budget),
                yield_per_acre=y,
                price=p,
                cost_per_acre=c,
                own=key in own,
            )
        )
    response.economics = Economics(
        region=budget.region if budget else None,
        currency=budget.currency if budget else None,
        basis=budget.basis if budget else NO_BUDGET_BASIS,
        cover_crop_cost=cover_cost,
        crops=lines,
        sources=budget.sources if budget else [],
    )
