import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import StrategyCard from "./StrategyCard";
import { ALTERNATIVE, BASELINE } from "./testData";

afterEach(cleanup);

test("shows all five parts of a strategy", () => {
  render(<StrategyCard strategy={ALTERNATIVE} />);

  expect(screen.getByText("Why it was suggested")).toBeTruthy();
  expect(screen.getByText("Possible benefits")).toBeTruthy();
  expect(screen.getByText("Evidence (1)")).toBeTruthy();
  expect(screen.getByText("What we don't know (1)")).toBeTruthy();
  expect(screen.getByText("Check locally")).toBeTruthy();
  expect(screen.getByText(/NASA POWER, 2006–2025 · wider area/)).toBeTruthy();
});

test("links each evidence source to where it can be read", () => {
  const evidence = [{ ...ALTERNATIVE.evidence[0], url: "https://power.larc.nasa.gov/" }];
  render(<StrategyCard strategy={{ ...ALTERNATIVE, evidence }} />);

  const link = screen.getByRole("link", { name: /NASA POWER, 2006–2025 · wider area/ });
  expect(link.getAttribute("href")).toBe("https://power.larc.nasa.gov/");
  expect(link.getAttribute("target")).toBe("_blank");
});

test("shows the fit score and a warning when the current rotation fails a check", () => {
  render(<StrategyCard strategy={{ ...BASELINE, warnings: ["Corn needs about 120 frost-free days."] }} />);

  expect(screen.getByText("58")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("120 frost-free days");
});

test("allows selecting an alternative strategy to compare in 3D", () => {
  const onSelect = vi.fn();
  const { rerender } = render(
    <StrategyCard strategy={ALTERNATIVE} isComparedIn3D={false} onSelectFor3D={onSelect} />,
  );

  const button = screen.getByRole("button", { name: "Compare in 3D" });
  expect(button.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(button);
  expect(onSelect).toHaveBeenCalledWith(ALTERNATIVE.id);

  rerender(<StrategyCard strategy={ALTERNATIVE} isComparedIn3D={true} onSelectFor3D={onSelect} />);
  const activeButton = screen.getByRole("button", { name: "Showing in 3D" });
  expect(activeButton.getAttribute("aria-pressed")).toBe("true");
});

test("uses accessible custom score bars with baseline markers instead of native <meter>", () => {
  const { container } = render(
    <StrategyCard strategy={ALTERNATIVE} baselineScores={{ ...BASELINE.scores, water: 0.7 }} />,
  );

  expect(container.querySelector("meter")).toBeNull();
  const meters = screen.getAllByRole("meter");
  expect(meters).toHaveLength(7);
  expect(meters[0].getAttribute("aria-valuemin")).toBe("0");
  expect(meters[0].getAttribute("aria-valuemax")).toBe("100");
  expect(meters[0].getAttribute("aria-valuenow")).toBe("42");
  expect(container.querySelectorAll(".score-baseline-pin").length).toBeGreaterThanOrEqual(7);
});

test("an option's detail ends in numbered steps to take before changing anything, and can be printed", () => {
  const print = vi.fn();
  vi.stubGlobal("print", print);
  render(
    <StrategyCard
      strategy={{ ...ALTERNATIVE, local_review: ["Rye needs a planting window right after harvest."] }}
      variant="detail"
    />,
  );

  const steps = screen.getByRole("list", { name: "Before you change anything" });
  expect(steps.tagName).toBe("OL");
  const items = [...steps.querySelectorAll("li")].map((li) => li.textContent);
  expect(items[0]).toBe("Rye needs a planting window right after harvest.");
  expect(items.at(-1)).toMatch(/Try it on one field or part of a field first/);

  fireEvent.click(screen.getByRole("button", { name: "Print for my advisor" }));
  expect(print).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});

test("the current rotation's detail has no change steps and no print button", () => {
  render(<StrategyCard strategy={BASELINE} variant="detail" />);

  expect(screen.queryByText("Before you change anything")).toBeNull();
  expect(screen.queryByRole("button", { name: "Print for my advisor" })).toBeNull();
  expect(screen.getByText("Check locally for this option")).toBeTruthy();
});
