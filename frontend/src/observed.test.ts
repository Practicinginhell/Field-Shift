import { expect, test } from "vitest";

import { dayOfYearText, modelText, observedFrames, observedSummary, stateText } from "./observed";
import type { ObservedField, ObservedMonth } from "./types";

const month = (m: number, state: ObservedMonth["state"], ndvi: number | null, flags: ObservedMonth["flags"] = []) => ({
  month: m,
  state,
  ndvi,
  ndvi_source: ndvi === null ? null : "HLS 30 m",
  views: ndvi === null ? 0 : 2,
  soil_moisture: null,
  flags,
});

const LOW_FLAG = {
  variable: "ndvi" as const,
  direction: "low" as const,
  observed: 0.4,
  expected_low: 0.6,
  expected_high: 0.9,
  methods: ["TimesFM 2.5", "Field average"],
};

const FIELD: ObservedField = {
  id: "ottawa",
  latitude: 45.22,
  longitude: -75.8,
  clear_view_share: 0.44,
  sources: [],
  methods: [],
  years: [
    {
      year: 2020,
      crop: "spring_wheat",
      crop_label: "Spring wheat",
      greenup: "2020-05-10",
      peak: "2020-07-27",
      dormancy: "2020-11-11",
      months: [
        month(1, "snow", -0.05),
        month(2, "no_view", null),
        month(3, "bare", 0.2),
        month(4, "bare", 0.25),
        month(5, "partial", 0.35),
        month(6, "green", 0.81),
        month(7, "green", 0.86, [LOW_FLAG]),
        month(8, "partial", 0.34),
        month(9, "green", 0.6),
        month(10, "green", 0.84),
        month(11, "partial", 0.37),
        month(12, "bare", 0.1),
      ],
    },
  ],
};

test("green months grow the year's mapped crop, bare and snow months show bare soil", () => {
  const frames = observedFrames(FIELD);

  expect(frames).toHaveLength(12);
  expect(frames[6]).toMatchObject({ state: "crop", crop: "spring_wheat" });
  expect(frames[6].growth).toBeGreaterThan(frames[4].growth);
  expect(frames[0]).toMatchObject({ state: "bare", crop: null });
  expect(frames[2]).toMatchObject({ state: "bare", crop: null });
});

test("a month with no clear view repeats the month before", () => {
  const frames = observedFrames(FIELD);

  expect(frames[1]).toEqual({ ...frames[0], rotationYear: 1 });
});

test("state text names the source and says when the satellite could not see", () => {
  expect(stateText(FIELD.years[0].months[5])).toBe("green (NDVI 0.81, HLS 30 m)");
  expect(stateText(FIELD.years[0].months[1])).toBe("no clear view (clouds)");
});

test("summary counts bare, snow, flagged and unseen months", () => {
  const s = observedSummary(FIELD, [false, false, false, false, true, false, false, false, false, false, false, false]);

  expect(s).toMatchObject({ bare: 3, snow: 1, noView: 1, flagged: 1, bareInHeavyRain: 0 });
});

test("modelText reports the classifier's reading and whether it matches the crop map", () => {
  const year = FIELD.years[0];
  expect(modelText({ ...year, model_crop: null })).toBeNull();
  expect(
    modelText({ ...year, model_crop: "spring_cereal", model_crop_label: "Spring cereal", model_confidence: 0.912, model_agrees: true }),
  ).toBe("Satellite curve reads: Spring cereal (91% sure), matches the crop map");
  expect(
    modelText({ ...year, model_crop: "corn", model_crop_label: "Corn", model_confidence: 0.55, model_agrees: false }),
  ).toBe("Satellite curve reads: Corn (55% sure), not what the crop map says: worth a check");
  expect(
    modelText({ ...year, model_crop: "corn", model_crop_label: "Corn", model_confidence: 0.6, model_agrees: null }),
  ).toBe("Satellite curve reads: Corn (60% sure)");
});

test("dayOfYearText turns a day of the year into a date", () => {
  expect(dayOfYearText(1)).toBe("Jan 1");
  expect(dayOfYearText(201)).toBe("Jul 20");
});
