import type { AnalyzeResponse, CropOption, MonthState, Strategy } from "./types";

const ET0 = [10, 15, 40, 80, 120, 150, 170, 150, 110, 70, 30, 15];
const bare: MonthState = { state: "bare", crop: null, growth: 0, water_mm: 0 };
const rye = (m: number): MonthState => ({ state: "cover", crop: "rye_cover", growth: 0.35, water_mm: [9, 10, 3, 4].includes(m) ? 0.5 * ET0[m] : 0 });

/** A summer crop's year: sown in May, canopy June–September; optional rye cover around it. */
function summerYear(crop: string, kc: number, cover: boolean): MonthState[] {
  return ET0.map((et0, m) => {
    if (m === 4) return { state: "planted", crop, growth: 0.1, water_mm: kc * et0 };
    if (m >= 5 && m <= 8) return { state: "crop", crop, growth: m === 5 ? 0.5 : 1, water_mm: kc * et0 };
    if (cover && (m <= 3 || m >= 9)) return rye(m);
    return bare;
  });
}

export const CROPS: CropOption[] = [
  { key: "corn", name: "Corn (grain)", cover_crop_ok: true },
  { key: "soybean", name: "Soybean", cover_crop_ok: true },
  { key: "alfalfa", name: "Alfalfa", cover_crop_ok: false },
  { key: "canola", name: "Canola", cover_crop_ok: true },
];

const strategy = (overrides: Partial<Strategy>): Strategy => ({
  id: "current",
  name: "Corn – Soybean",
  years: [
    { crop: "corn", cover: false },
    { crop: "soybean", cover: false },
  ],
  is_baseline: true,
  scores: { water: 0.42, soil: 0.45, nitrogen: 0.5, erosion: 0.51, pests: 0.5, forage: 0.4, income: 1 },
  total: 0.58,
  why: ["This is your current rotation. The other options are compared with it."],
  evidence: [
    {
      dataset: "NASA POWER",
      variable: "Frost-free season (median)",
      value: "176 days",
      period: "2006–2025",
      place: "NASA POWER grid cell (about 50 km) around the field",
      support: "regional",
    },
  ],
  benefits: ["You already know how to grow it."],
  gaps: ["No local price data yet, so income uses a general market class."],
  local_review: ["Local pests and diseases decide how much a rotation helps."],
  water_demand_mm: 578,
  rainfed_shortfall_mm: 0,
  cover_months: 4,
  warnings: [],
  calendar: [summerYear("corn", 0.85, false), summerYear("soybean", 0.8, false)],
  ...overrides,
});

export const BASELINE = strategy({});
export const ALTERNATIVE = strategy({
  id: "current-plus-cover",
  name: "Corn + rye cover – Soybean + rye cover",
  is_baseline: false,
  total: 0.67,
  calendar: [summerYear("corn", 0.85, true), summerYear("soybean", 0.8, true)],
  why: ["Suggested because you care about reducing erosion, and it scores better there."],
});

export const RESPONSE: AnalyzeResponse = {
  latitude: 42.1,
  longitude: -93.95,
  conditions: {
    period: "2006–2025",
    annual_precip_mm: 860,
    annual_et0_mm: 998,
    monthly_precip_mm: [20, 25, 50, 90, 120, 130, 110, 110, 80, 60, 40, 25],
    monthly_et0_mm: ET0,
    monthly_heavy_rain_days: [0, 0, 0, 0.5, 0.6, 0.2, 0.1, 0.1, 0.2, 0.4, 0, 0],
    monthly_heat_days: [0, 0, 0, 0, 0, 0.5, 2, 1, 0, 0, 0, 0],
    frost_months: [true, true, true, true, false, false, false, false, false, true, true, true],
    frost_free_days: 176,
    soil: { map_unit: "Dundas silt loam", component: "Dundas", slope_percent: 1, organic_matter_percent: 6 },
    erosion_susceptibility: "moderate",
    summary: ["From 2006 to 2025, this area got about 860 mm of rain a year."],
  },
  strategies: [BASELINE, ALTERNATIVE, strategy({ id: "x", name: "Alfalfa (3 yrs) – Corn", is_baseline: false })],
  removed: [{ name: "Wheat – Sorghum – Fallow", reason: "Sorghum needs about 110 frost-free days." }],
  weights: { water: 3, soil: 3, nitrogen: 2, erosion: 3, pests: 2, forage: 1, income: 3 },
  notes: ["This tool suggests options to explore. It does not decide for you."],
};
