import { expect, test } from "vitest";

import { setLang } from "./i18n";
import { applyMargins, rotationMargin } from "./margin";
import { ALTERNATIVE, BASELINE } from "./testData";
import type { CropNumbers } from "./types";

// Iowa State 2026 budget and USDA prices: the same numbers as backend/tests/test_economics.py.
const IOWA: Record<string, CropNumbers> = {
  corn: { yield_per_acre: 211, price: 4.6, cost_per_acre: 483.6 },
  soybean: { yield_per_acre: 61, price: 12.1, cost_per_acre: 290.21 },
};
const NAMES = { corn: "Corn (grain)", soybean: "Soybean", canola: "Canola" };

test("matches the backend: corn and soybean in Iowa", () => {
  const corn = { crop: "corn", cover: false };
  const soy = { crop: "soybean", cover: false };
  expect(rotationMargin([corn, soy], IOWA, 41.55, NAMES).value).toBeCloseTo((487.0 + 447.89) / 2);
  const covered = rotationMargin([{ ...corn, cover: true }, { ...soy, cover: true }], IOWA, 41.55, NAMES);
  expect(covered.value).toBeCloseTo((487.0 + 447.89) / 2 - 41.55);
});

test("names what is missing instead of guessing", () => {
  const r = rotationMargin([{ crop: "canola", cover: true }], IOWA, null, NAMES);
  expect(r.value).toBeNull();
  expect(r.missing).toEqual(["Canola", "Winter rye cover"]);

  setLang("fr");
  try {
    const fr = rotationMargin([{ crop: "canola", cover: true }], IOWA, null, NAMES);
    expect(fr.missing).toEqual(["Canola", "Couvert de seigle d'automne"]);
  } finally {
    setLang("en");
  }
});

test("recomputes every rotation and its difference from the current one", () => {
  const withRye = { ...ALTERNATIVE, years: [{ crop: "corn", cover: true }, { crop: "soybean", cover: true }] };
  const [base, alt] = applyMargins([BASELINE, withRye], IOWA, 41.55, NAMES);
  expect(base.margin).toEqual({ per_acre: 467, vs_current: 0, missing: [] });
  expect(alt.margin).toEqual({ per_acre: 426, vs_current: -42, missing: [] });
});
