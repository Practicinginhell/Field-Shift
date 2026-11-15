// Shapes returned by the backend API (backend/app/models.py).

// "soil" is organic-matter gain; "income" is market suitability (the brief's names).
export type Criterion = "water" | "soil" | "nitrogen" | "erosion" | "pests" | "forage" | "income";

export interface RotationYear {
  crop: string;
  cover: boolean;
}

export type Priorities = Record<Criterion, number>;

export interface CropOption {
  key: string;
  name: string;
  cover_crop_ok: boolean;
}

export interface Evidence {
  dataset: string;
  variable: string;
  value: string;
  period: string;
  place: string;
  support: "field-level" | "regional" | "general reference" | "farmer input";
  /** A page where a reader can look up the source. */
  url?: string | null;
}

export interface MonthState {
  state: "crop" | "planted" | "cover" | "bare";
  crop: string | null;
  growth: number;
  water_mm: number;
}

export interface Strategy {
  id: string;
  name: string;
  years: RotationYear[];
  is_baseline: boolean;
  scores: Record<Criterion, number>;
  total: number;
  why: string[];
  evidence: Evidence[];
  benefits: string[];
  gaps: string[];
  local_review: string[];
  water_demand_mm: number;
  rainfed_shortfall_mm: number;
  cover_months: number;
  warnings: string[];
  calendar: MonthState[][];
  margin?: Margin | null;
}

/** Gross margin of a rotation, per acre a year (yield x price - costs, before land). */
export interface Margin {
  per_acre: number | null;
  vs_current: number | null;
  /** Crops without numbers, by name. */
  missing: string[];
}

/** One crop's yield, price and cost per acre. */
export interface CropNumbers {
  yield_per_acre: number;
  price: number;
  cost_per_acre: number;
}

export interface CropLine {
  crop: string;
  name: string;
  /** "bu", "t" (tonne) or "ton" (short ton). */
  unit: string;
  yield_per_acre: number | null;
  price: number | null;
  cost_per_acre: number | null;
  own: boolean;
}

export interface Economics {
  /** The published budget used, or null: the farmer enters numbers. */
  region: string | null;
  currency: string | null;
  basis: string;
  cover_crop_cost: number | null;
  crops: CropLine[];
  sources: string[];
}

export interface Soil {
  map_unit: string;
  component: string;
  slope_percent: number | null;
  organic_matter_percent: number | null;
}

export interface Conditions {
  period: string;
  annual_precip_mm: number;
  annual_et0_mm: number;
  monthly_precip_mm: number[];
  monthly_et0_mm: number[];
  monthly_heavy_rain_days: number[];
  monthly_heat_days: number[];
  frost_months: boolean[];
  frost_free_days: number;
  heat_days_per_year?: number;
  heavy_rain_days_per_year?: number;
  recent_precip_change_percent?: number | null;
  recent_tmax_change_c?: number | null;
  soil: Soil | null;
  erosion_susceptibility: "low" | "moderate" | "high" | "unknown";
  summary: string[];
}

export interface AnalyzeResponse {
  latitude: number;
  longitude: number;
  conditions: Conditions;
  strategies: Strategy[];
  removed: { name: string; reason: string }[];
  weights: Priorities;
  notes: string[];
  economics?: Economics | null;
}

export interface CropHistory {
  years: { year: number; cdl_category: string | null; crop: string | null }[];
  source: string;
}

export interface StressFlag {
  variable: "ndvi" | "soil_moisture";
  direction: "low" | "high";
  observed: number;
  expected_low: number;
  expected_high: number;
  methods: string[];
}

export interface ObservedMonth {
  month: number;
  state: "green" | "partial" | "bare" | "snow" | "no_view";
  ndvi: number | null;
  ndvi_source: string | null;
  views: number;
  soil_moisture: number | null;
  flags: StressFlag[];
}

export interface ObservedYear {
  year: number;
  crop: string | null;
  crop_label: string | null;
  greenup: string | null;
  peak: string | null;
  dormancy: string | null;
  months: ObservedMonth[];
  /** The crop classifier's reading of this year's greenness curve (null: too few clear views). */
  model_crop?: string | null;
  model_crop_label?: string | null;
  model_confidence?: number | null;
  /** Matches the crop map? null when the map's crop isn't one the model knows. */
  model_agrees?: boolean | null;
}

export interface CropModelScore {
  name: string;
  accuracy: number;
  macro_f1: number;
  per_class_f1: number[];
}

export interface CropModel {
  chosen: string;
  classes: string[];
  methods: CropModelScore[];
  n_train: number;
  n_test: number;
  test_note: string;
  /** Days of the year that separate the crops best. */
  telling_days: number[];
}

export interface MethodScore {
  name: string;
  mean_abs_error: number;
  band_coverage: number;
  note: string;
}

export interface ObservedField {
  id: string;
  latitude: number;
  longitude: number;
  years: ObservedYear[];
  clear_view_share: number;
  sources: string[];
  methods: MethodScore[];
  crop_model?: CropModel | null;
}
