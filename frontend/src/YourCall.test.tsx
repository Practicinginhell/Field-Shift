import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import YourCall from "./YourCall";

afterEach(cleanup);

test("renders each farmer decision in an aligned action card with icons and fires the matching control", () => {
  const onOpen = vi.fn();
  const { container } = render(
    <YourCall goals="Save water, Add organic matter +2" irrigated={false} ruledOut={[]} onOpen={onOpen} />,
  );

  const region = screen.getByRole("region", { name: "Your call" });
  expect(region.querySelector(".your-call-grid")).toBeTruthy();
  expect(region.querySelectorAll(".your-call-card")).toHaveLength(3);

  const prioritiesBtn = screen.getByRole("button", { name: "Change what matters most" });
  const waterBtn = screen.getByRole("button", { name: "Change your water" });
  const cropsBtn = screen.getByRole("button", { name: "Rule out crops you can't grow or sell" });

  for (const btn of [prioritiesBtn, waterBtn, cropsBtn]) {
    expect(btn.classList.contains("your-call-btn")).toBe(true);
    expect(btn.querySelector("svg[aria-hidden='true']")).toBeTruthy();
  }

  expect(container.textContent).toContain("Save water, Add organic matter +2");
  expect(container.textContent).toContain("Rainfed");
  expect(container.textContent).toContain("No crops ruled out");

  fireEvent.click(prioritiesBtn);
  fireEvent.click(waterBtn);
  fireEvent.click(cropsBtn);
  expect(onOpen.mock.calls).toEqual([["priorities"], ["water"], ["crops"]]);
});

test("displays irrigated status and ruled-out crop list when configured", () => {
  render(<YourCall goals="Save water +3" irrigated={true} ruledOut={["Alfalfa", "Canola"]} onOpen={() => {}} />);

  expect(screen.getByText("Irrigated")).toBeTruthy();
  expect(screen.getByText("Ruled out: Alfalfa, Canola")).toBeTruthy();
});
