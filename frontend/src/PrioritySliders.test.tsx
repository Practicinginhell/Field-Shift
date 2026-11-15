import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import PrioritySliders from "./PrioritySliders";
import type { Priorities } from "./types";

afterEach(cleanup);

const PRIORITIES: Priorities = { water: 3, soil: 3, nitrogen: 2, erosion: 3, pests: 2, forage: 1, income: 3 };

test("offers every priority the brief names, each as its own slider", () => {
  const mixed: Priorities = { ...PRIORITIES, forage: 0, soil: 5 };
  render(<PrioritySliders priorities={mixed} onChange={vi.fn()} />);

  for (const name of [
    "Save water",
    "Add organic matter",
    "Fix nitrogen (legumes)",
    "Reduce erosion",
    "Break pest cycles",
    "Forage for livestock",
    "Market suitability",
  ]) {
    expect(screen.getByLabelText(name)).toBeTruthy();
  }

  const waterSlider = screen.getByLabelText("Save water") as HTMLInputElement;
  const zeroSlider = screen.getByLabelText("Forage for livestock") as HTMLInputElement;
  const maxSlider = screen.getByLabelText("Add organic matter") as HTMLInputElement;

  expect(waterSlider.style.getPropertyValue("--pct")).toBe("60%");
  expect(zeroSlider.style.getPropertyValue("--pct")).toBe("0%");
  expect(maxSlider.style.getPropertyValue("--pct")).toBe("100%");
  expect(waterSlider.closest(".priority-row")?.getAttribute("data-criterion")).toBe("water");
  expect(zeroSlider.closest(".priority-row")?.getAttribute("data-criterion")).toBe("forage");
  expect(maxSlider.closest(".priority-row")?.getAttribute("data-criterion")).toBe("soil");
  expect(zeroSlider.closest(".priority-row")?.classList.contains("is-zero")).toBe(true);
  expect(maxSlider.closest(".priority-row")?.classList.contains("is-high")).toBe(true);
});

test("renders decorative criterion icon badges, 0-5 discrete step ticks, and emits updated values", () => {
  const onChange = vi.fn();
  const mixed: Priorities = { ...PRIORITIES, water: 3, forage: 0, soil: 5 };
  const { container } = render(<PrioritySliders priorities={mixed} onChange={onChange} />);

  const rows = [...container.querySelectorAll(".priority-row")];
  expect(rows).toHaveLength(7);

  for (const row of rows) {
    const badge = row.querySelector(".priority-badge");
    expect(badge?.getAttribute("aria-hidden")).toBe("true");
    expect(badge?.querySelector("svg")).toBeTruthy();

    const wrap = row.querySelector(".priority-slider-wrap");
    const ticks = wrap?.querySelectorAll(".priority-ticks[aria-hidden='true'] .priority-tick");
    expect(ticks).toHaveLength(6);
  }

  const activeFlags = (criterion: string) =>
    [
      ...container.querySelectorAll(
        `.priority-row[data-criterion="${criterion}"] .priority-tick`,
      ),
    ].map((t) => t.getAttribute("data-active"));

  expect(activeFlags("water")).toEqual(["true", "true", "true", "true", "false", "false"]);
  expect(activeFlags("forage")).toEqual(["true", "false", "false", "false", "false", "false"]);
  expect(activeFlags("soil")).toEqual(["true", "true", "true", "true", "true", "true"]);

  fireEvent.change(screen.getByLabelText("Save water"), { target: { value: "5" } });
  expect(onChange).toHaveBeenCalledWith({ ...mixed, water: 5 });
});
