import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import RotationList, { compareInWords } from "./RotationList";
import { ALTERNATIVE, BASELINE, RESPONSE } from "./testData";

afterEach(cleanup);

const option = {
  ...ALTERNATIVE,
  scores: { water: 0.3, soil: 0.7, nitrogen: 0.52, erosion: 0.9, pests: 0.5, forage: 0.9, income: 0.7 },
};

test("names the goals an option is better and worse for, most important to the farmer first", () => {
  const weights = { ...RESPONSE.weights, forage: 0 };
  const words = compareInWords(option, BASELINE, weights);
  // Soil (+25) and erosion (+39) both weigh 3; income (−30) and water (−12) are worse.
  // Nitrogen moves 2 points (too small to call) and forage has weight 0 (the farmer skipped it).
  expect(words.better).toEqual(["soil", "erosion"]);
  expect(words.worse).toEqual(["water", "income"]);
});

test("shows each rotation in plain words and opens its details", () => {
  const onSelect = vi.fn();
  render(
    <RotationList
      strategies={[BASELINE, option]}
      weights={RESPONSE.weights}
      selectedId={null}
      onSelectStrategy={onSelect}
    />,
  );

  const yours = screen.getByRole("listitem", { name: /Your current rotation/ });
  expect(within(yours).getByText(/about 578 mm of water a year/)).toBeTruthy();
  expect(within(yours).queryByText(/Better for/)).toBeNull();

  const opt = screen.getByRole("listitem", { name: /Option to explore/ });
  expect(within(opt).getByText("Better for")).toBeTruthy();
  expect(within(opt).getByText(/organic matter, erosion control, livestock feed/)).toBeTruthy();
  expect(within(opt).getByText(/saving water, markets/)).toBeTruthy();
  // No scores in the plain view.
  expect(within(opt).queryByText(/\/ 100/)).toBeNull();

  fireEvent.click(within(opt).getByRole("button", { name: /See why and what to check/ }));
  expect(onSelect).toHaveBeenCalledWith(option.id);
});

test("says so when an option scores about the same as the current rotation on the farmer's goals", () => {
  render(
    <RotationList
      strategies={[BASELINE, { ...ALTERNATIVE, scores: BASELINE.scores }]}
      weights={RESPONSE.weights}
      selectedId={null}
      onSelectStrategy={() => {}}
    />,
  );
  expect(screen.getByText(/About the same as your rotation on the goals you rated/)).toBeTruthy();
});

test("shows each rotation's gross margin and how it compares with the farmer's", () => {
  render(
    <RotationList
      strategies={[
        { ...BASELINE, margin: { per_acre: 467, vs_current: 0, missing: [] } },
        { ...option, margin: { per_acre: 426, vs_current: -42, missing: [] } },
        { ...ALTERNATIVE, id: "canola", name: "With canola", margin: { per_acre: null, vs_current: null, missing: ["Canola"] } },
      ]}
      weights={RESPONSE.weights}
      currency="USD"
      selectedId={null}
      onSelectStrategy={() => {}}
    />,
  );

  const yours = screen.getByRole("listitem", { name: /Your current rotation/ });
  expect(within(yours).getByText(/Gross margin about \$467 an acre a year/)).toBeTruthy();
  const [first, second] = screen.getAllByRole("listitem", { name: /Option to explore/ });
  expect(within(first).getByText(/\$426 an acre a year/)).toBeTruthy();
  expect(within(first).getByText(/\$42 less than yours/)).toBeTruthy();
  expect(within(second).getByText(/Needs your numbers for: Canola/)).toBeTruthy();
});

test("shows Canadian dollars as C$", () => {
  render(
    <RotationList
      strategies={[{ ...BASELINE, margin: { per_acre: 383, vs_current: 0, missing: [] } }]}
      weights={RESPONSE.weights}
      currency="CAD"
      selectedId={null}
      onSelectStrategy={() => {}}
    />,
  );
  expect(screen.getByText(/Gross margin about C\$383 an acre a year/)).toBeTruthy();
});

test("on an irrigated field the gap is irrigation water, not a rain shortfall", () => {
  render(
    <RotationList
      strategies={[{ ...BASELINE, rainfed_shortfall_mm: 648 }]}
      weights={RESPONSE.weights}
      irrigated
      selectedId={null}
      onSelectStrategy={() => {}}
    />,
  );
  expect(screen.getByText(/needs about 648 mm of irrigation a year/)).toBeTruthy();
  expect(screen.queryByText(/rain falls about/)).toBeNull();
});
