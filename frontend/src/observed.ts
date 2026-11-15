// "Replay your field from space": turn the satellite record of a field (what NASA
// satellites saw, month by month) into frames the 3D scene can draw.

import { type PlotFrame, SHORT_MONTHS } from "./season";
import type { ObservedField, ObservedMonth, ObservedYear } from "./types";
import { num, t } from "./i18n";

/** NDVI → plant height in the scene: 0.1 (bare) → small, about 0.85 (full canopy) → 1. */
function growthFromNdvi(ndvi: number): number {
  return Math.min(1, Math.max(0.15, (ndvi - 0.1) / 0.75));
}

/** One frame per observed month, in order (year by year, January first). */
export function observedFrames(field: ObservedField): PlotFrame[] {
  const frames: PlotFrame[] = [];
  field.years.forEach((year, yearIdx) => {
    for (const m of year.months) {
      const rotationYear = yearIdx + 1;
      const previous = frames[frames.length - 1];
      if (m.state === "no_view") {
        frames.push(previous ? { ...previous, rotationYear } : bareFrame(rotationYear));
      } else if (m.state === "green" || m.state === "partial") {
        frames.push({
          state: year.crop ? "crop" : "cover",
          crop: year.crop,
          growth: growthFromNdvi(m.ndvi ?? 0.5),
          water_mm: 0,
          rotationYear,
          ripe: false,
        });
      } else {
        frames.push(bareFrame(rotationYear));
      }
    }
  });
  return frames;
}

function bareFrame(rotationYear: number): PlotFrame {
  return { state: "bare", crop: null, growth: 0, water_mm: 0, rotationYear, ripe: false };
}

export const STATE_WORDS: Record<ObservedMonth["state"], string> = {
  green: "green",
  partial: "partly green",
  bare: "bare or just sown",
  snow: "likely snow-covered",
  no_view: "no clear view (clouds)",
};

/** What the month looked like, in words only: "green", "bare or just sown", "likely snow-covered". */
export function plainStateText(m: ObservedMonth): string {
  return t(m.state === "no_view" || m.ndvi === null ? STATE_WORDS.no_view : STATE_WORDS[m.state]);
}

export function stateText(m: ObservedMonth): string {
  if (m.state === "no_view" || m.ndvi === null) return t(STATE_WORDS.no_view);
  return `${t(STATE_WORDS[m.state])} (NDVI ${num(Number(m.ndvi.toFixed(2)))}, ${m.ndvi_source})`;
}

export interface ObservedSummary {
  bare: number;
  snow: number;
  noView: number;
  flagged: number;
  /** Bare months that fall in a month with frequent heavy rain (field average). */
  bareInHeavyRain: number;
}

export function observedSummary(field: ObservedField, heavyRainMonths: boolean[]): ObservedSummary {
  const all = field.years.flatMap((y) => y.months);
  return {
    bare: all.filter((m) => m.state === "bare").length,
    snow: all.filter((m) => m.state === "snow").length,
    noView: all.filter((m) => m.state === "no_view").length,
    flagged: all.filter((m) => m.flags.length > 0).length,
    bareInHeavyRain: all.filter((m) => m.state === "bare" && heavyRainMonths[m.month - 1]).length,
  };
}

/** "Less green than expected (both methods)" style text for a month's flags. */
export function flagText(m: ObservedMonth): string | null {
  if (m.flags.length === 0) return null;
  return m.flags
    .map((f) => {
      const what =
        f.variable === "ndvi"
          ? f.direction === "low"
            ? t("Less green than expected")
            : t("Greener than expected")
          : f.direction === "low"
            ? t("Drier soil than expected")
            : t("Wetter soil than expected");
      const who = f.methods.length > 1 ? t("both methods agree") : t("{method} only", { method: f.methods[0] });
      return `${what} (${who})`;
    })
    .join(" · ");
}

/** The crop classifier's reading of a year, or null when it had too few clear views. */
export function modelText(y: ObservedYear): string | null {
  if (!y.model_crop || !y.model_crop_label || y.model_confidence == null) return null;
  const base = t("Satellite curve reads: {crop} ({pct}% sure)", {
    crop: y.model_crop_label,
    pct: Math.round(y.model_confidence * 100),
  });
  if (y.model_agrees === true) return base + t(", matches the crop map");
  if (y.model_agrees === false) return base + t(", not what the crop map says: worth a check");
  return base;
}

/** Day of the year (1–366, a non-leap year) → "Jul 20". */
export function dayOfYearText(day: number): string {
  const d = new Date(Date.UTC(2023, 0, day));
  return t("{month} {day}", { month: t(SHORT_MONTHS[d.getUTCMonth()]), day: d.getUTCDate() });
}
