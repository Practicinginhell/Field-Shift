"""Request and response shapes for the API."""

from typing import Literal

from pydantic import BaseModel, Field

Support = Literal["field-level", "regional", "general reference", "farmer input"]
# The brief's farmer priorities. "soil" is organic-matter gain (living cover, deep
# roots); "income" is market suitability.
Criterion = Literal["water", "soil", "nitrogen", "erosion", "pests", "forage", "income"]


class RotationYear(BaseModel):
    crop: str
    """A key from `app.crops.CROPS`."""
    cover: bool = False
    """A winter cover crop (cereal rye) follows this year's crop."""


class Priorities(BaseModel):
    """How much the farmer cares about each goal, 0 (not at all) to 5 (most)."""

    water: int = Field(3, ge=0, le=5)
    soil: int = Field(3, ge=0, le=5)
    nitrogen: int = Field(2, ge=0, le=5)
    erosion: int = Field(3, ge=0, le=5)
    pests: int = Field(2, ge=0, le=5)
    forage: int = Field(1, ge=0, le=5)
    income: int = Field(3, ge=0, le=5)


class CropNumbers(BaseModel):
    """One crop's numbers per acre, from a published budget or the farmer."""

    yield_per_acre: float = Field(ge=0, le=100_000)
    """In the crop's unit (bushels, tonnes or tons per acre)."""
    price: float = Field(ge=0, le=100_000)
    """Per unit of yield."""
    cost_per_acre: float = Field(ge=0, le=100_000)


class AnalyzeRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    current_rotation: list[RotationYear] = Field(min_length=1, max_length=8)
    irrigated: bool = False
    priorities: Priorities = Priorities()
    excluded_crops: list[str] = Field(default_factory=list, max_length=20)
    """Crops the farmer can't grow or sell here (no buyer, no equipment)."""
    own_numbers: dict[str, CropNumbers] = Field(default_factory=dict, max_length=20)
    """The farmer's own yield, price and cost for a crop, by crop key."""
    own_cover_cost: float | None = Field(None, ge=0, le=10_000)
    """The farmer's own cost of a winter rye cover crop, per acre."""
    language: Literal["en", "fr"] = "en"
    """The language of every sentence in the answer."""


class Evidence(BaseModel):
    dataset: str
    variable: str
    value: str
    period: str
    place: str
    support: Support
    url: str | None = None
    """A page where a reader can look up the source (dataset or reference)."""


class MonthState(BaseModel):
    """What the field looks like in one month of one rotation year."""

    state: Literal["crop", "planted", "cover", "bare"]
    """crop: living crop cover; planted: sown, little cover yet; cover: winter cover
    crop; bare: no living cover."""
    crop: str | None
    growth: float
    """0 (nothing) to 1 (full canopy), from the crop calendar."""
    water_mm: float
    """Crop water use this month: crop coefficient x the month's reference ET."""


class Strategy(BaseModel):
    id: str
    name: str
    years: list[RotationYear]
    is_baseline: bool
    scores: dict[Criterion, float]
    """Each criterion 0 (worst) to 1 (best), before weighting."""
    total: float
    """Scores weighted by the farmer's priorities, 0 to 1."""
    why: list[str]
    evidence: list[Evidence]
    benefits: list[str]
    gaps: list[str]
    local_review: list[str]
    water_demand_mm: float
    """Average crop water use per year, mm."""
    rainfed_shortfall_mm: float
    """Average yearly gap between crop water use and rain plus stored soil water, mm."""
    cover_months: float
    """Average months per year with living cover."""
    warnings: list[str] = []
    """Hard-limit problems. Only the baseline can carry these; others are removed."""
    calendar: list[list[MonthState]] = []
    """One list of 12 calendar months (Jan..Dec) per rotation year, in order."""
    margin: "Margin | None" = None


class Margin(BaseModel):
    """Gross margin of a rotation: yield x price - costs, averaged over its years."""

    per_acre: float | None
    """Per acre a year, rounded; None when a crop (or the cover crop) has no numbers."""
    vs_current: float | None
    """Difference from the farmer's current rotation, per acre a year."""
    missing: list[str] = []
    """Crops without numbers, by name; "Winter rye cover" when its cost is missing."""


class CropLine(BaseModel):
    """The numbers used for one crop, so the farmer can see and replace them."""

    crop: str
    name: str
    unit: str
    """Yield unit: "bu", "t" (tonne) or "ton" (short ton)."""
    yield_per_acre: float | None
    price: float | None
    cost_per_acre: float | None
    own: bool = False
    """True when these are the farmer's own numbers."""


class Economics(BaseModel):
    """Where the margin numbers come from and what they include."""

    region: str | None
    """The published budget used ("Iowa", "Ontario"), or None: the farmer enters numbers."""
    currency: str | None
    """"USD" or "CAD"; None when there is no regional budget."""
    basis: str
    """What the costs include and leave out."""
    cover_crop_cost: float | None
    crops: list[CropLine]
    sources: list[str]


class RemovedStrategy(BaseModel):
    name: str
    reason: str


class Soil(BaseModel):
    map_unit: str
    component: str
    slope_percent: float | None
    hydrologic_group: str | None
    drainage_class: str | None
    organic_matter_percent: float | None
    available_water_cm_per_cm: float | None
    clay_percent: float | None
    sand_percent: float | None
    erodibility_k: float | None


class Conditions(BaseModel):
    period: str
    annual_precip_mm: float
    annual_et0_mm: float
    monthly_precip_mm: list[float]
    monthly_et0_mm: list[float]
    monthly_heavy_rain_days: list[float]
    monthly_heat_days: list[float]
    frost_months: list[bool]
    """Calendar months (Jan..Dec) in which frost is usual, from the median frost dates."""
    last_spring_frost: str | None
    first_fall_frost: str | None
    frost_free_days: int
    heat_days_per_year: float
    heavy_rain_days_per_year: float
    recent_precip_change_percent: float | None
    recent_tmax_change_c: float | None
    soil: Soil | None
    erosion_susceptibility: Literal["low", "moderate", "high", "unknown"]
    summary: list[str]
    """Plain-language sentences about the field's conditions."""


class AnalyzeResponse(BaseModel):
    latitude: float
    longitude: float
    conditions: Conditions
    strategies: list[Strategy]
    """The baseline first, then alternatives from best to worst total."""
    removed: list[RemovedStrategy]
    weights: dict[Criterion, int]
    notes: list[str]
    economics: Economics | None = None


class CropOption(BaseModel):
    key: str
    name: str
    cover_crop_ok: bool


class CropHistoryYear(BaseModel):
    year: int
    cdl_category: str | None
    crop: str | None
    """Matching key in `app.crops.CROPS`, or `None` if the class has no match."""


class CropHistory(BaseModel):
    years: list[CropHistoryYear]
    source: str


class StressFlag(BaseModel):
    """A month that fell outside the range a method expected for this field."""

    variable: Literal["ndvi", "soil_moisture"]
    direction: Literal["low", "high"]
    observed: float
    expected_low: float
    expected_high: float
    methods: list[str]
    """Which methods flagged it, e.g. ["TimesFM 2.5", "Field average"]."""


class ObservedMonth(BaseModel):
    month: int
    state: Literal["green", "partial", "bare", "snow", "no_view"]
    ndvi: float | None
    ndvi_source: str | None
    """"HLS 30 m" or "MODIS 250 m" (used only when HLS had no clear view)."""
    views: int
    soil_moisture: float | None
    """SMAP L3 surface (0–5 cm) soil moisture (m³/m³), monthly mean; regional (9 km)."""
    flags: list[StressFlag] = []


class ObservedYear(BaseModel):
    year: int
    crop: str | None
    crop_label: str | None
    greenup: str | None
    peak: str | None
    dormancy: str | None
    months: list[ObservedMonth]
    model_crop: str | None = None
    """The crop classifier's reading of this year's greenness curve (tools/train_crop_model.py)."""
    model_crop_label: str | None = None
    model_confidence: float | None = None
    """The classifier's probability for its answer, 0–1."""
    model_agrees: bool | None = None
    """Whether it matches the crop map; None when the map's crop isn't one it knows."""


class MethodScore(BaseModel):
    name: str
    mean_abs_error: float
    band_coverage: float
    """Share of held-out months inside the method's 10–90% band (ideal: about 0.8)."""
    note: str


class CropModelScore(BaseModel):
    name: str
    accuracy: float
    macro_f1: float
    per_class_f1: list[float]


class CropModel(BaseModel):
    """A crop classifier trained on HLS greenness curves, labelled by AAFC's crop map."""

    chosen: str
    """The approach the app uses, picked on validation data (never on the test set)."""
    classes: list[str]
    methods: list[CropModelScore]
    """Scores on the test set: new years in new places."""
    n_train: int
    n_test: int
    test_note: str
    telling_days: list[int]
    """Days of the year that separate the crops best (XGBoost feature gain)."""


class ObservedField(BaseModel):
    id: str
    latitude: float
    longitude: float
    years: list[ObservedYear]
    clear_view_share: float
    """Share of HLS overpasses with a usable (cloud-free) value."""
    sources: list[str]
    methods: list[MethodScore] = []
    crop_model: CropModel | None = None
    series: dict[str, dict] = {}
    """Monthly series for the SI step: {"modis_ndvi": {"start": "2000-01", "values": [...]}}."""
