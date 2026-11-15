// Pure logic behind the 3D season view: which month is showing, what each field looks
// like, and the running scoreboard. Everything comes from the API response.

import type { Conditions, MonthState, Strategy } from "./types";
import { num, t } from "./i18n";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type CameraView = "overview" | "roots" | "canopy";

/** A month counts as erosion-prone when it averages at least this many heavy-rain days. */
export const HEAVY_RAIN_MONTH = 0.3;
const MAX_CYCLE_YEARS = 6;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Years to play so all rotations line up again; capped to keep the loop short. */
export function cycleYears(...lengths: number[]): number {
  if (lengths.length === 0) return 1;
  const lcm = lengths.reduce((acc, n) => (acc * n) / gcd(acc, n), 1);
  return lcm <= MAX_CYCLE_YEARS ? lcm : Math.max(...lengths);
}

export interface PlotFrame extends MonthState {
  /** 1-based year within this strategy's own rotation. */
  rotationYear: number;
  /** The crop is at its last month before harvest. */
  ripe: boolean;
}

export function plotFrame(strategy: Strategy, step: number): PlotFrame {
  const years = strategy.calendar.length;
  const yearIndex = Math.floor(step / 12) % years;
  const month = step % 12;
  const here = strategy.calendar[yearIndex][month];
  const nextStep = step + 1;
  const next = strategy.calendar[Math.floor(nextStep / 12) % years][nextStep % 12];
  const ripe = here.state === "crop" && here.growth >= 1 && (next.state !== "crop" || next.crop !== here.crop);
  return { ...here, rotationYear: yearIndex + 1, ripe };
}

export interface WeatherFrame {
  month: number;
  rainMm: number;
  et0Mm: number;
  heavyRainDays: number;
  heatDays: number;
  frost: boolean;
}

export function weatherFrame(conditions: Conditions, step: number): WeatherFrame {
  const m = step % 12;
  return {
    month: m,
    rainMm: conditions.monthly_precip_mm[m],
    et0Mm: conditions.monthly_et0_mm[m],
    heavyRainDays: conditions.monthly_heavy_rain_days[m],
    heatDays: conditions.monthly_heat_days[m],
    frost: conditions.frost_months[m],
  };
}

export interface Tally {
  waterMm: number;
  bareMonths: number;
  /** Bare months that fall in an erosion-prone (heavy-rain) month. */
  soilAtRisk: number;
}

/** Running totals from the first month up to and including `step`. */
export function tally(strategy: Strategy, conditions: Conditions, step: number): Tally {
  const total: Tally = { waterMm: 0, bareMonths: 0, soilAtRisk: 0 };
  for (let s = 0; s <= step; s++) {
    const frame = plotFrame(strategy, s);
    total.waterMm += frame.water_mm;
    if (frame.state === "bare" || frame.state === "planted") {
      total.bareMonths += 1;
      if (conditions.monthly_heavy_rain_days[s % 12] >= HEAVY_RAIN_MONTH) total.soilAtRisk += 1;
    }
  }
  total.waterMm = Math.round(total.waterMm);
  return total;
}

export interface TallyDiff {
  waterDiffMm: number;
  bareMonthsDiff: number;
  soilAtRiskDiff: number;
}

/** Difference between an option's running tally and the baseline's tally. */
export function compareTally(current: Tally, baseline: Tally): TallyDiff {
  return {
    waterDiffMm: current.waterMm - baseline.waterMm,
    bareMonthsDiff: current.bareMonths - baseline.bareMonths,
    soilAtRiskDiff: current.soilAtRisk - baseline.soilAtRisk,
  };
}

/**
 * Height of the midday sun above the horizon, in degrees, for a latitude (degrees,
 * north positive) in the middle of a month (0 = January). Kept at 4° or more so the
 * scene is never unlit.
 */
export function sunElevationDeg(latitude: number, month: number): number {
  const dayOfYear = month * 30.4 + 15;
  const declination = -23.44 * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365);
  return Math.max(4, 90 - Math.abs(latitude - declination));
}

export interface WaterBalance {
  rainMm: number;
  useMm: number;
  /** Rain minus crop water use; negative means the crop draws on stored soil water or irrigation. */
  balanceMm: number;
}

/** The month's average rain against the water this plot's crop uses, in whole millimetres. */
export function waterBalance(frame: PlotFrame, weather: WeatherFrame): WaterBalance {
  const rainMm = Math.round(weather.rainMm);
  const useMm = Math.round(frame.water_mm);
  return { rainMm, useMm, balanceMm: rainMm - useMm };
}

/** How wet to draw a plot's soil, 0 (dry) to 1 (wet), from the month's water balance. */
export function plotWetness(frame: PlotFrame, weather: WeatherFrame): number {
  return Math.min(1, Math.max(0, 0.5 + waterBalance(frame, weather).balanceMm / 120));
}

export interface KeyMoment {
  kind: "exposed" | "water" | "roots";
  /** Month to jump to, counted from the first month of the played cycle. */
  step: number;
  label: string;
  detail: string;
}

const isExposed = (frame: PlotFrame) => frame.state === "bare" || frame.state === "planted";

/**
 * The months worth looking at first: where the options differ most from the current
 * rotation (`strategies[0]`) in soil cover during heavy rain, water use, and living
 * roots. A kind is left out when no option differs on it.
 */
export function keyMoments(strategies: Strategy[], conditions: Conditions, steps: number): KeyMoment[] {
  const [current, ...options] = strategies;
  if (!current || options.length === 0) return [];
  const optionName = (i: number) => (options.length > 1 ? t("Option {n}", { n: i + 1 }) : t("Option"));

  let exposed: KeyMoment | null = null;
  const widest: { water?: { gap: number; moment: KeyMoment }; roots?: { gap: number; moment: KeyMoment } } = {};

  for (let step = 0; step < steps; step++) {
    const mine = plotFrame(current, step);
    const theirs = options.map((o) => plotFrame(o, step));

    if (!exposed && isExposed(mine) && conditions.monthly_heavy_rain_days[step % 12] >= HEAVY_RAIN_MONTH) {
      const covered = theirs.filter((f) => !isExposed(f)).length;
      if (covered > 0) {
        exposed = {
          kind: "exposed",
          step,
          label: t("Heavy rain on bare soil"),
          detail:
            covered === 1
              ? t("{n} of {total} options keeps the soil covered", { n: covered, total: options.length })
              : t("{n} of {total} options keep the soil covered", { n: covered, total: options.length }),
        };
      }
    }

    theirs.forEach((frame, i) => {
      const diff = Math.round(frame.water_mm) - Math.round(mine.water_mm);
      if (Math.abs(diff) >= 5 && Math.abs(diff) > (widest.water?.gap ?? 0)) {
        widest.water = {
          gap: Math.abs(diff),
          moment: {
            kind: "water",
            step,
            label: t("Largest water-use gap"),
            detail:
              diff > 0
                ? t("{option} uses {mm} mm more than your rotation", { option: optionName(i), mm: Math.abs(diff) })
                : t("{option} uses {mm} mm less than your rotation", { option: optionName(i), mm: Math.abs(diff) }),
          },
        };
      }
      const depth = rootProfile(frame).activeDepthM;
      if (rootProfile(mine).activeDepthM === 0 && depth >= 0.2 && depth > (widest.roots?.gap ?? 0)) {
        widest.roots = {
          gap: depth,
          moment: {
            kind: "roots",
            step,
            label: t("Living roots where yours has none"),
            detail: t("{option} roots reach about {m} m", { option: optionName(i), m: num(Number(depth.toFixed(1))) }),
          },
        };
      }
    });
  }

  return [exposed, widest.water?.moment, widest.roots?.moment].filter((m): m is KeyMoment => Boolean(m));
}

export const CROP_LABELS: Record<string, string> = { rye_cover: "Rye cover crop" };

export function describe(frame: PlotFrame, cropNames: Record<string, string>): string {
  const name = frame.crop ? (CROP_LABELS[frame.crop] ? t(CROP_LABELS[frame.crop]) : (cropNames[frame.crop] ?? frame.crop)) : "";
  switch (frame.state) {
    case "bare":
      return t("Bare soil");
    case "planted":
      return t("{name}, just sown (little cover yet)", { name });
    case "cover":
      return t("{name}, protecting the soil", { name });
    case "crop":
      if (frame.ripe) return t("{name}, ready to harvest", { name });
      if (frame.growth < 0.4) return t("{name}, resting over winter", { name });
      return frame.growth >= 1 ? t("{name}, full canopy", { name }) : t("{name}, growing", { name });
  }
}

export type RootArchitecture = "fibrous" | "taproot" | "none";

export interface RootProfile {
  maxDepthM: number;
  activeDepthM: number;
  nitrogenFixing: boolean;
  architecture: RootArchitecture;
}

const CROP_ROOT_TRAITS: Record<string, { maxDepthM: number; nitrogenFixing: boolean; architecture: RootArchitecture }> = {
  corn: { maxDepthM: 1.2, nitrogenFixing: false, architecture: "fibrous" },
  soybean: { maxDepthM: 0.9, nitrogenFixing: true, architecture: "taproot" },
  sorghum: { maxDepthM: 1.4, nitrogenFixing: false, architecture: "fibrous" },
  winter_wheat: { maxDepthM: 1.5, nitrogenFixing: false, architecture: "fibrous" },
  spring_wheat: { maxDepthM: 1.2, nitrogenFixing: false, architecture: "fibrous" },
  oats: { maxDepthM: 1.0, nitrogenFixing: false, architecture: "fibrous" },
  barley: { maxDepthM: 1.0, nitrogenFixing: false, architecture: "fibrous" },
  canola: { maxDepthM: 1.0, nitrogenFixing: false, architecture: "taproot" },
  field_pea: { maxDepthM: 0.8, nitrogenFixing: true, architecture: "taproot" },
  alfalfa: { maxDepthM: 1.5, nitrogenFixing: true, architecture: "taproot" },
  rye_cover: { maxDepthM: 1.0, nitrogenFixing: false, architecture: "fibrous" },
  fallow: { maxDepthM: 0, nitrogenFixing: false, architecture: "none" },
};

/** Active FAO-56 root depth (meters), root architecture, and legume nitrogen fixation for one plot frame. */
export function rootProfile(frame: PlotFrame): RootProfile {
  if (frame.state === "bare" || !frame.crop) {
    return { maxDepthM: 0, activeDepthM: 0, nitrogenFixing: false, architecture: "none" };
  }
  const traits = CROP_ROOT_TRAITS[frame.crop] ?? { maxDepthM: 0.8, nitrogenFixing: false, architecture: "fibrous" };
  const factor = frame.state === "planted" ? 0.15 : Math.max(frame.growth, 0.2);
  return {
    maxDepthM: traits.maxDepthM,
    activeDepthM: Number((traits.maxDepthM * factor).toFixed(2)),
    nitrogenFixing: traits.nitrogenFixing,
    architecture: traits.architecture,
  };
}

/** Compact label for the 3D plot HUD badge. */
export function shortStateLabel(frame: PlotFrame, cropNames: Record<string, string>): string {
  const name = frame.crop ? (CROP_LABELS[frame.crop] ? t(CROP_LABELS[frame.crop]) : (cropNames[frame.crop] ?? frame.crop)) : "";
  switch (frame.state) {
    case "bare":
      return t("Bare soil");
    case "planted":
      return t("{name} · Just sown", { name });
    case "cover":
      return t("{name} · Living cover", { name });
    case "crop":
      if (frame.ripe) return t("{name} · Ready to harvest", { name });
      if (frame.growth < 0.4) return t("{name} · Overwintering", { name });
      return frame.growth >= 1 ? t("{name} · Full canopy", { name }) : t("{name} · Growing", { name });
  }
}

/** Concise crop + cover label for a given 0-based year index in the timeline header. */
export function yearCropLabel(strategy: Strategy, yearIndex: number, cropNames: Record<string, string>): string {
  if (strategy.years.length === 0) return "";
  const entry = strategy.years[yearIndex % strategy.years.length];
  if (!entry) return "";
  const crop = CROP_LABELS[entry.crop] ? t(CROP_LABELS[entry.crop]) : (cropNames[entry.crop] ?? entry.crop);
  const calYear = strategy.calendar[yearIndex % strategy.calendar.length];
  const hasCover = entry.cover || Boolean(calYear?.some((m) => m.state === "cover"));
  return hasCover ? t("{crop} + rye cover", { crop }) : crop;
}

const PLOT_SPAN = 5.4;
/** World height of the soil surface, and the drawn depth of the soil profile below it. */
export const SOIL_TOP = 0.15;
export const SOIL_DEPTH = 0.9;
/** The "Soil & roots" view draws the profile this many times deeper than true scale. */
export const ROOTS_SOIL_EXAGGERATION = 3;

/** How many times deeper than true scale the soil profile is drawn in a camera view. */
export function soilExaggeration(view: CameraView): number {
  return view === "roots" ? ROOTS_SOIL_EXAGGERATION : 1;
}
const HALF_FOV_TAN = Math.tan((45 * Math.PI) / 360);

/** Spacing between adjacent plot centers for `n` plots in 3D. */
export function plotSpacingForCount(count: number): number {
  return count <= 2 ? 6.8 : 6.35;
}

/**
 * Computes camera position and OrbitControls look-at target so `count` side-by-side
 * plots fit cleanly with margin at any canvas aspect ratio and view preset.
 */
export function computeFittedCamera(
  view: CameraView,
  count: number,
  aspect: number,
): { pos: [number, number, number]; target: [number, number, number] } {
  const safeCount = Math.max(1, count);
  const safeAspect = Math.max(0.45, aspect || 1.6);
  const spacing = plotSpacingForCount(safeCount);
  const totalWidth = (safeCount - 1) * spacing + PLOT_SPAN + 1.4;
  const horizHalfFov = HALF_FOV_TAN * safeAspect;
  const distForWidth = totalWidth / 2 / horizHalfFov;

  switch (view) {
    case "roots": {
      // Level with the cut face. Far enough to fit all plots across and the whole
      // drawn profile (soil bottom to the tallest crop) top to bottom.
      const bottom = SOIL_TOP - SOIL_DEPTH * ROOTS_SOIL_EXAGGERATION - 0.2;
      const top = 2.35;
      const distForHeight = ((top - bottom) / 2 / HALF_FOV_TAN) * 1.04;
      const d = Math.max(distForWidth * 1.12, distForHeight);
      // When the width sets the distance there is height to spare: give most of it to
      // the sky, where the plot labels sit, rather than to the trench floor.
      const spare = d * HALF_FOV_TAN - (top - bottom) / 2;
      const centerY = (top + bottom) / 2 + Math.max(0, spare) * 0.55;
      return {
        pos: [0, centerY + 0.5, PLOT_SPAN / 2 + d],
        target: [0, centerY, PLOT_SPAN / 2],
      };
    }
    case "canopy": {
      const h = Math.max(9.2, distForWidth * 1.2);
      return {
        pos: [0, h, 2.2],
        target: [0, 0, 0],
      };
    }
    case "overview":
    default: {
      // Scale distance and elevation together so wide bands fit without leaving a dark bottom slab.
      // The plots' near edge is half a plot closer than their centre, and it has to fit too.
      const d = Math.max(7.9, distForWidth * 1.04 + PLOT_SPAN / 2);
      // Low enough that the horizon, woodland trees, barn silhouette, clouds, and sun show clearly above any plot count.
      const y = Math.max(2.4, d * 0.27);
      return {
        pos: [0, y, d],
        target: [0, 0.14, 0],
      };
    }
  }
}

export interface ZoomBounds {
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  fitDistance: number;
}

/** Computes zoom distance and vertical orbit bounds relative to the fitted camera framing. */
export function computeZoomBounds(view: CameraView, count: number, aspect: number): ZoomBounds {
  const { pos, target } = computeFittedCamera(view, count, aspect);
  const fitDistance = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
  const minDistance = Number(Math.max(4.5, fitDistance * 0.45).toFixed(2));
  const maxDistance = Number(Math.min(30, Math.max(14, fitDistance * 1.55)).toFixed(2));
  const minPolarAngle = view === "canopy" ? 0.05 : 0.2;
  const maxPolarAngle = view === "roots" ? 1.54 : 1.48;
  return { minDistance, maxDistance, minPolarAngle, maxPolarAngle, fitDistance };
}
