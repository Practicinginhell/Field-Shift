import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import MonthlyWaterChart from "./MonthlyWaterChart";

afterEach(cleanup);

test("leaves enough left SVG padding so 3-digit y-axis labels like 154 mm do not clip", () => {
  const rain = [24, 28, 52, 82, 108, 126, 154, 118, 86, 62, 42, 30];
  const et0 = [12, 16, 40, 80, 112, 134, 146, 130, 92, 58, 28, 14];
  const { container } = render(<MonthlyWaterChart rain={rain} et0={et0} />);

  const topLabel = screen.getByText("154 mm");
  const x = Number(topLabel.getAttribute("x"));
  expect(x).toBeGreaterThanOrEqual(42);

  const svg = container.querySelector("svg")!;
  const viewBox = (svg.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
  expect(viewBox[2]).toBeGreaterThanOrEqual(340);
});
