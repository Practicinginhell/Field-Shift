// Gross margin per acre a year, recomputed in the browser as the farmer types their
// own numbers. Mirrors backend/app/economics.py (rotation_margin and add_margins);
// margin.test.ts checks both give the same Iowa figures.

import { t } from "./i18n";
import type { CropLine, CropNumbers, Economics, RotationYear, Strategy } from "./types";

export const COVER_NAME = "Winter rye cover";

/** Mean yearly margin of a rotation, or null with the names of what has no numbers. */
export function rotationMargin(
  years: RotationYear[],
  numbers: Record<string, CropNumbers>,
  coverCost: number | null,
  names: Record<string, string>,
): { value: number | null; missing: string[] } {
  const missing: string[] = [];
  let total = 0;
  for (const y of years) {
    const n = numbers[y.crop];
    if (!n) {
      const name = names[y.crop] ?? y.crop;
      if (!missing.includes(name)) missing.push(name);
    } else {
      total += n.yield_per_acre * n.price - n.cost_per_acre;
    }
    if (y.cover) {
      if (coverCost === null) {
        const coverName = t(COVER_NAME);
        if (!missing.includes(coverName)) missing.push(coverName);
      } else {
        total -= coverCost;
      }
    }
  }
  return missing.length ? { value: null, missing } : { value: total / years.length, missing: [] };
}

/** Each strategy with its margin and its difference from the first (current) rotation. */
export function applyMargins(
  strategies: Strategy[],
  numbers: Record<string, CropNumbers>,
  coverCost: number | null,
  names: Record<string, string>,
): Strategy[] {
  let base: number | null = null;
  return strategies.map((s, i) => {
    const { value, missing } = rotationMargin(s.years, numbers, coverCost, names);
    if (i === 0) base = value;
    const vs = value === null || base === null ? null : Math.round(value - base);
    return { ...s, margin: { per_acre: value === null ? null : Math.round(value), vs_current: vs, missing } };
  });
}

/** The numbers in the economics table: every crop line with a yield, price and cost. */
export function numbersFrom(lines: CropLine[]): Record<string, CropNumbers> {
  const out: Record<string, CropNumbers> = {};
  for (const l of lines) {
    if (l.yield_per_acre !== null && l.price !== null && l.cost_per_acre !== null) {
      out[l.crop] = { yield_per_acre: l.yield_per_acre, price: l.price, cost_per_acre: l.cost_per_acre };
    }
  }
  return out;
}

/** What the farmer has typed: complete rows by crop (a row being typed is left out), and the cover cost. */
export interface TypedNumbers {
  numbers: Record<string, CropNumbers>;
  coverCost: number | null;
}

/** The table's numbers with the farmer's typing on top. */
export function liveNumbers(economics: Economics, typed: TypedNumbers | null): TypedNumbers {
  if (typed) return typed;
  return { numbers: numbersFrom(economics.crops), coverCost: economics.cover_crop_cost };
}
