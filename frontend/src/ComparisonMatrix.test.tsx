import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import ComparisonMatrix, { orderedCriteriaByWeight } from "./ComparisonMatrix";
import { ALTERNATIVE, BASELINE } from "./testData";
import type { Priorities, Strategy } from "./types";

afterEach(cleanup);

const OPT2: Strategy = {
  ...ALTERNATIVE,
  id: "alfalfa-mix",
  name: "Alfalfa (3 yrs) – Corn",
  total: 0.72,
  scores: {
    ...ALTERNATIVE.scores,
    soil: 0.92,
    erosion: 0.9,
    forage: 0.95,
    water: 0.27,
  },
};

const WEIGHTS: Priorities = {
  water: 5,
  soil: 4,
  nitrogen: 2,
  erosion: 3,
  pests: 2,
  forage: 0,
  income: 1,
};

test("orders criteria descending by farmer weights and puts zero-weight criteria last", () => {
  const ordered = orderedCriteriaByWeight(WEIGHTS);
  expect(ordered[0]).toBe("water");
  expect(ordered[1]).toBe("soil");
  expect(ordered[2]).toBe("erosion");
  expect(ordered[ordered.length - 1]).toBe("forage");
});

test("pins current rotation first, shows deltas and column bests, never labels a winner", () => {
  const onSelect = vi.fn();
  const { container } = render(
    <ComparisonMatrix
      strategies={[ALTERNATIVE, BASELINE, OPT2]}
      weights={WEIGHTS}
      selectedIds={[ALTERNATIVE.id]}
      highlightedId={ALTERNATIVE.id}
      onSelectStrategy={onSelect}
    />,
  );

  // Baseline is sorted first visually even if passed second in array.
  const rows = container.querySelectorAll("tbody tr");
  expect(rows).toHaveLength(3);
  expect(rows[0].textContent).toContain("Your current rotation");
  expect(rows[0].textContent).toContain("Corn – Soybean");
  expect(rows[1].textContent).toContain("Option to explore");
  expect(rows[2].textContent).toContain("Option to explore");
  expect(container.textContent).not.toMatch(/winner/i);

  // Zero-weight criterion column is marked de-emphasised.
  expect(container.querySelector("th.is-zero-weight")?.textContent).toContain("Forage for livestock");

  // Fit score and soil score deltas relative to baseline (58 total, 45 soil).
  // OPT2 has 72 total (+14 vs 58) and 92 soil (+47 vs 45).
  expect(rows[2].textContent).toContain("+14");
  expect(rows[2].textContent).toContain("+47");

  // Column best markers exist and there are best cells marked in OPT2.
  expect(container.querySelectorAll("td.is-best").length).toBeGreaterThanOrEqual(3);

  // Clicking a row's inspect trigger calls onSelectStrategy with that id.
  fireEvent.click(screen.getByRole("button", { name: /Inspect Alfalfa \(3 yrs\) – Corn/i }));
  expect(onSelect).toHaveBeenCalledWith(OPT2.id);
});
