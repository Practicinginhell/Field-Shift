import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import RotationEditor from "./RotationEditor";
import { CROPS } from "./testData";

afterEach(cleanup);

test("adds a year that repeats the last crop", () => {
  const onChange = vi.fn();
  render(<RotationEditor crops={CROPS} rotation={[{ crop: "corn", cover: false }]} onChange={onChange} />);

  fireEvent.click(screen.getByRole("button", { name: "Add a year" }));

  expect(onChange).toHaveBeenCalledWith([
    { crop: "corn", cover: false },
    { crop: "corn", cover: false },
  ]);
});

test("disables the cover crop for crops that cannot take one, and clears it on change", () => {
  const onChange = vi.fn();
  render(<RotationEditor crops={CROPS} rotation={[{ crop: "corn", cover: true }]} onChange={onChange} />);

  fireEvent.change(screen.getByLabelText("Year 1 crop"), { target: { value: "alfalfa" } });

  expect(onChange).toHaveBeenCalledWith([{ crop: "alfalfa", cover: false }]);
});

test("does not offer to remove the only year", () => {
  render(<RotationEditor crops={CROPS} rotation={[{ crop: "corn", cover: false }]} onChange={vi.fn()} />);

  expect(screen.queryByRole("button", { name: "Remove year 1" })).toBeNull();
});

test("explains why a crop cannot take a winter cover crop", () => {
  render(<RotationEditor crops={CROPS} rotation={[{ crop: "alfalfa", cover: false }]} onChange={vi.fn()} />);

  expect(screen.getByText(/already cover the soil over winter/)).toBeTruthy();
});

test("shows no cover-crop explanation when every year can take one", () => {
  render(<RotationEditor crops={CROPS} rotation={[{ crop: "corn", cover: false }]} onChange={vi.fn()} />);

  expect(screen.queryByText(/already cover the soil over winter/)).toBeNull();
});
