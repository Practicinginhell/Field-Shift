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
