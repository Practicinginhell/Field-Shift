import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import SatelliteReplay from "./SatelliteReplay";
import { RESPONSE } from "./testData";
import type { ObservedField, ObservedMonth } from "./types";

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children?: ReactNode }) => <div data-testid="canvas">{children}</div>,
}));

vi.mock("./FieldScene", () => ({
  default: () => null,
}));

afterEach(cleanup);

const month = (m: number, state: ObservedMonth["state"], ndvi: number | null): ObservedMonth => ({
  month: m,
  state,
  ndvi,
  ndvi_source: ndvi === null ? null : "HLS 30 m",
  views: ndvi === null ? 0 : 2,
  soil_moisture: state === "bare" ? 0.24 : null,
  flags: [],
});

const FIELD: ObservedField = {
  id: "ottawa",
  latitude: 45.22,
  longitude: -75.8,
  clear_view_share: 0.44,
  sources: ["HLS", "MODIS", "SMAP"],
  methods: [{ name: "TimesFM 2.5", mean_abs_error: 0.09, band_coverage: 0.81, note: "2019-2024 holdout" }],
  years: [
    {
      year: 2019,
      crop: "soybean",
      crop_label: "Soybeans",
      greenup: "2019-05-14",
      peak: "2019-08-03",
      dormancy: "2019-10-20",
      months: [
        month(1, "snow", -0.02),
        month(2, "snow", -0.04),
        month(3, "no_view", null),
        month(4, "bare", 0.28),
        month(5, "partial", 0.36),
        month(6, "partial", 0.42),
        month(7, "green", 0.84),
        month(8, "green", 0.89),
        month(9, "green", 0.72),
        month(10, "bare", 0.24),
        month(11, "bare", 0.19),
        month(12, "snow", -0.01),
      ],
    },
  ],
};

test("renders J-D month column headers in the replay grid and keeps scoreboards structured", () => {
  const { container } = render(
    <SatelliteReplay field={FIELD} conditions={RESPONSE.conditions} latitude={RESPONSE.latitude} cropNames={{ soybean: "Soybean" }} />,
  );

  const stage = container.querySelector(".season-stage");
  const statusBar = container.querySelector(".replay-status-bar");
  expect(stage).toBeTruthy();
  expect(statusBar).toBeTruthy();
  expect(stage?.contains(statusBar ?? null)).toBe(false);
  expect(statusBar?.textContent).toContain("Soybean");

  const headerRow = screen.getByRole("row", { name: "Months" });
  expect(within(headerRow).getAllByText(/^[JFMASOND]$/)).toHaveLength(12);
  expect(screen.getByText("2019 season")).toBeTruthy();
  expect(screen.getByText("Greened up")).toBeTruthy();
  expect(screen.getByText("2019–2019, observed")).toBeTruthy();
});

test("collapses methodology tables and caveats under a one-click disclosure without deleting them", () => {
  render(<SatelliteReplay field={FIELD} conditions={RESPONSE.conditions} latitude={RESPONSE.latitude} cropNames={{ soybean: "Soybean" }} />);

  const summary = screen.getByText(/How this was worked out/);
  const details = summary.closest("details") as HTMLDetailsElement;
  expect(details).toBeTruthy();
  expect(details.open).toBe(false);

  fireEvent.click(summary);
  expect(screen.getByText("TimesFM 2.5")).toBeTruthy();
  expect(screen.getByText(/Soil moisture is for a 9 km area/)).toBeTruthy();
});

test("keeps index values out of the plain view and shows them while the working is open", () => {
  const { container } = render(
    <SatelliteReplay field={FIELD} conditions={RESPONSE.conditions} latitude={RESPONSE.latitude} cropNames={{ soybean: "Soybean" }} />,
  );

  const tag = () => container.querySelector(".stage-tags")?.textContent ?? "";
  expect(tag()).toContain("Observed");
  expect(tag()).not.toContain("NDVI");
  expect(container.querySelector(".replay-grid")?.textContent).not.toContain("Unusual month");

  const details = screen.getByText(/How this was worked out/).closest("details") as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(tag()).toContain("NDVI");
  expect(container.querySelector(".replay-grid")?.textContent).toContain("Unusual month");
  expect(details.textContent).toContain("SMAP, 9 km area");
});
