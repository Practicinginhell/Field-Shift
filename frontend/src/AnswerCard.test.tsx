import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import AnswerCard from "./AnswerCard";
import { ALTERNATIVE, BASELINE } from "./testData";

afterEach(cleanup);

const base = { ...BASELINE, total: 0.55, cover_months: 4, water_demand_mm: 569, margin: { per_acre: 467, vs_current: 0, missing: [] } };
const top = {
  ...ALTERNATIVE,
  total: 0.66,
  cover_months: 11,
  water_demand_mm: 687,
  margin: { per_acre: 426, vs_current: -42, missing: [] },
};

test("leads with one suggestion, what it changes, and who decides", () => {
  const onSeeWhy = vi.fn();
  render(
    <AnswerCard
      baseline={base}
      top={top}
      currency="USD"
      newCrops={["Canola"]}
      checks={["Seed the rye within two weeks of harvest."]}
      onSeeWhy={onSeeWhy}
    />,
  );

  const card = screen.getByRole("region", { name: /Our suggestion for your field/ });
  expect(within(card).getByRole("heading", { name: top.name })).toBeTruthy();
  expect(within(card).getByText(/about 11 months a year \(now 4\)/)).toBeTruthy();
  expect(within(card).getByText(/\$426 an acre a year, \$42 less than now/)).toBeTruthy();
  expect(within(card).getByText(/buyer and the equipment for canola/)).toBeTruthy();
  expect(within(card).getByText("Seed the rye within two weeks of harvest.")).toBeTruthy();
  expect(within(card).getByText(/you make the call/)).toBeTruthy();

  fireEvent.click(within(card).getByRole("button", { name: "See why and the evidence" }));
  expect(onSeeWhy).toHaveBeenCalledWith(top.id);
});

test("says so when the current rotation already fits best", () => {
  render(<AnswerCard baseline={base} top={{ ...top, total: 0.5 }} currency="USD" newCrops={[]} checks={[]} onSeeWhy={() => {}} />);
  expect(screen.getByRole("heading", { name: /Your current rotation fits what you told us best/ })).toBeTruthy();
});

test("offers the smaller first step: the farmer's own crops plus a winter cover", () => {
  const big = { ...top, id: "alfalfa-corn", name: "Alfalfa (3 yrs) – Corn", total: 0.69 };
  const step = { ...top, id: "current-plus-cover", total: 0.65 };
  render(<AnswerCard baseline={base} top={big} firstStep={step} currency="USD" newCrops={[]} checks={[]} onSeeWhy={() => {}} />);
  const block = screen.getByRole("heading", { name: "A smaller first step" }).parentElement!;
  expect(within(block).getByText(new RegExp(step.name.replace(/[+]/g, "\\+")))).toBeTruthy();
  expect(within(block).getByText(/soil covered about 11 months a year, \$42 an acre a year less than now/)).toBeTruthy();
});

test("says which numbers are missing instead of hiding the margin", () => {
  const noHay = { ...top, margin: { per_acre: null, vs_current: null, missing: ["Alfalfa"] } };
  render(<AnswerCard baseline={base} top={noHay} currency="CAD" newCrops={[]} checks={[]} onSeeWhy={() => {}} />);
  expect(screen.getByText(/Gross margin: enter your numbers for alfalfa in "Your yields and prices"/)).toBeTruthy();
});
