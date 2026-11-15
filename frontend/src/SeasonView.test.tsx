import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import SeasonView from "./SeasonView";
import type { PlotFrame, WeatherFrame } from "./season";
import { CROPS, RESPONSE } from "./testData";

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children?: ReactNode }) => <div data-testid="canvas">{children}</div>,
}));

vi.mock("./FieldScene", () => ({
  default: () => null,
  erosionRisk: (frame: PlotFrame, weather: WeatherFrame) =>
    (frame.state === "bare" || frame.state === "planted") && weather.heavyRainDays >= 0.3,
}));

afterEach(cleanup);

const cropNames = Object.fromEntries(CROPS.map((c) => [c.key, c.name]));

test("renders interactive month timeline and prev/next step controls", () => {
  render(<SeasonView strategies={RESPONSE.strategies} conditions={RESPONSE.conditions} latitude={RESPONSE.latitude} cropNames={cropNames} />);

  // Baseline and first alternative are both 2-year rotations => 24 monthly steps.
  const mayButton = screen.getByRole("button", { name: "Year 1, May" });
  expect(mayButton).toBeTruthy();
  expect(screen.getByRole("button", { name: "Year 2, December" })).toBeTruthy();

  const nextBtn = screen.getByRole("button", { name: "Next month" });
  const prevBtn = screen.getByRole("button", { name: "Previous month" });

  fireEvent.click(nextBtn);
  expect(screen.getByText(/February/)).toBeTruthy();

  fireEvent.click(prevBtn);
  expect(screen.getByText(/January/)).toBeTruthy();

  fireEvent.click(mayButton);
  expect(screen.getByText(/May/)).toBeTruthy();
  expect(mayButton.getAttribute("aria-current")).toBe("step");

  expect(screen.getByRole("button", { name: "Year 1, May" }).closest(".timeline-year")?.classList.contains("active-year")).toBe(
    true,
  );
  expect(document.querySelectorAll(".timeline-row-keys .row-crop").length).toBeGreaterThanOrEqual(6);
  expect(screen.getByText(/Top = Your rotation/)).toBeTruthy();
  expect(
    screen.getAllByText(/Yours: Corn \(grain\) · Opt 1: Corn \(grain\) \+ rye cover · Opt 2: Corn \(grain\)/).length,
  ).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText("Yours").length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText("Opt 1").length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText("Opt 2").length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText("Option 1").length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText("Option 2").length).toBeGreaterThanOrEqual(1);
});

test("displays comparison delta badges in the option scoreboard relative to baseline", () => {
  render(<SeasonView strategies={RESPONSE.strategies} conditions={RESPONSE.conditions} latitude={RESPONSE.latitude} cropNames={cropNames} />);

  // Jump to Year 1, December (step 11) where cover crop saves bare months and heavy-rain risk months.
  fireEvent.click(screen.getByRole("button", { name: "Year 1, December" }));

  // Baseline has 8 bare months, Option has 1 bare month => -7 vs current.
  expect(screen.getByText(/-7 vs current/)).toBeTruthy();
  // Baseline has 3 soilAtRisk months, Option has 1 => -2 vs current.
  expect(screen.getByText(/-2 vs current/)).toBeTruthy();
});

test("offers 3D camera view presets and updates active state when clicked", () => {
  render(<SeasonView strategies={RESPONSE.strategies} conditions={RESPONSE.conditions} latitude={RESPONSE.latitude} cropNames={cropNames} />);

  const overview = screen.getByRole("button", { name: "Overview" });
  const roots = screen.getByRole("button", { name: "Soil & roots" });
  const canopy = screen.getByRole("button", { name: "Top-down canopy" });

  expect(overview.getAttribute("aria-pressed")).toBe("true");
  expect(roots.getAttribute("aria-pressed")).toBe("false");
  expect(canopy.getAttribute("aria-pressed")).toBe("false");

  fireEvent.click(roots);
  expect(roots.getAttribute("aria-pressed")).toBe("true");
  expect(overview.getAttribute("aria-pressed")).toBe("false");
});

test("displays active FAO-56 root depth and nitrogen fixing status in scoreboards", () => {
  render(<SeasonView strategies={RESPONSE.strategies} conditions={RESPONSE.conditions} latitude={RESPONSE.latitude} cropNames={cropNames} />);

  // Year 1, July: all 3 strategies grow corn (1.2 m) in RESPONSE test data.
  fireEvent.click(screen.getByRole("button", { name: "Year 1, July" }));
  expect(screen.getAllByText("1.2 m (fibrous)")).toHaveLength(3);

  // Year 2, July: all 3 strategies grow soybean (0.9 m, nitrogen-fixing).
  fireEvent.click(screen.getByRole("button", { name: "Year 2, July" }));
  expect(screen.getAllByText("0.9 m (taproot · fixes N)")).toHaveLength(3);
});

test("jumps to the requested calendar month when selectedMonthRequest updates", () => {
  const onActiveMonthChange = vi.fn();
  const { rerender } = render(
    <SeasonView
      latitude={RESPONSE.latitude}
      strategies={RESPONSE.strategies}
      conditions={RESPONSE.conditions}
      cropNames={cropNames}
      onActiveMonthChange={onActiveMonthChange}
    />,
  );

  // Move into Year 2, February first so we can verify jumping preserves the active year.
  fireEvent.click(screen.getByRole("button", { name: "Year 2, February" }));
  expect(screen.getByRole("button", { name: "Year 2, February" }).getAttribute("aria-current")).toBe("step");
  expect(onActiveMonthChange).toHaveBeenCalledWith(1);

  rerender(
    <SeasonView
      latitude={RESPONSE.latitude}
      strategies={RESPONSE.strategies}
      conditions={RESPONSE.conditions}
      cropNames={cropNames}
      selectedMonthRequest={{ month: 6, seq: 1 }}
      onActiveMonthChange={onActiveMonthChange}
    />,
  );

  expect(screen.getByRole("button", { name: "Year 2, July" }).getAttribute("aria-current")).toBe("step");
});

test("offers jump buttons to the months where options differ most, and explains the one in view", () => {
  render(<SeasonView strategies={RESPONSE.strategies} conditions={RESPONSE.conditions} latitude={RESPONSE.latitude} cropNames={cropNames} />);

  const exposed = screen.getByRole("button", { name: /Heavy rain on bare soil.*Apr, year 1/ });
  fireEvent.click(exposed);
  expect(screen.getByRole("button", { name: "Year 1, April" }).getAttribute("aria-current")).toBe("step");
  expect(exposed.getAttribute("aria-pressed")).toBe("true");
  // April: Option 1 has rye cover, Option 2 is as bare as the current rotation.
  expect(screen.getByText(/1 of 2 options keeps the soil covered/)).toBeTruthy();
});

test("shows each plot's rain minus crop water use for the month in view", () => {
  render(<SeasonView strategies={RESPONSE.strategies} conditions={RESPONSE.conditions} latitude={RESPONSE.latitude} cropNames={cropNames} />);

  fireEvent.click(screen.getByRole("button", { name: "Year 1, July" }));
  // Corn in July: 110 mm of rain against 145 mm of crop water use.
  expect(screen.getAllByText("110 − 145 = −35 mm").length).toBeGreaterThanOrEqual(1);
});

test("says the soil is drawn deeper than scale in the Soil & roots view only", () => {
  render(<SeasonView strategies={RESPONSE.strategies} conditions={RESPONSE.conditions} latitude={RESPONSE.latitude} cropNames={cropNames} />);

  expect(screen.queryByText(/deeper than true scale/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Soil & roots" }));
  expect(screen.getByText(/drawn 3× deeper than true scale/)).toBeTruthy();
});

test("describes each rotation's month in plain words, with the figures one click away", () => {
  const { container } = render(
    <SeasonView strategies={RESPONSE.strategies} conditions={RESPONSE.conditions} latitude={RESPONSE.latitude} cropNames={cropNames} />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Year 1, April" }));
  const lines = [...container.querySelectorAll(".month-lines li")].map((li) => li.textContent);
  expect(lines[0]).toContain("Your rotation");
  expect(lines[0]).toContain("Bare soil");
  expect(lines[0]).toContain("bare soil in a heavy-rain month");
  expect(lines[1]).toContain("Rye cover crop, protecting the soil");
  expect(container.querySelector(".weather-line")?.textContent).toBe("Typical weather this month: rain 90 mm · frost likely · heavy rain likely");
  // The numbers are kept, inside the disclosure.
  expect(container.querySelector("details.month-figures .live-strip-grid")).toBeTruthy();
  expect(container.querySelector("details.month-figures")?.textContent).toContain("evaporative demand 80 mm");
  expect(screen.getByText("Opt 1 · Rye cover")).toBeTruthy();
});
