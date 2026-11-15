import { afterEach, expect, test } from "vitest";

import { PRESETS, SECTION_LINKS } from "./App";
import { FR } from "./fr";
import { num, setLang, t } from "./i18n";
import { STATE_WORDS } from "./observed";
import { CRITERION_NAMES } from "./PrioritySliders";
import { GOAL_IN_WORDS } from "./RotationList";
import { CROP_LABELS, MONTH_NAMES, SHORT_MONTHS } from "./season";
import { CAMERA_VIEWS } from "./SeasonView";
import { SUPPORT_LABEL } from "./StrategyCard";

afterEach(() => setLang("en"));

// The app's own source files, as text (Vite reads them at test time).
const SOURCES = import.meta.glob(["./*.ts", "./*.tsx", "!./*.test.*", "!./fr.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Every literal key passed to t("...") or t('...') in the app's source files. */
function keysInSource(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const [file, text] of Object.entries(SOURCES)) {
    for (const m of text.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.set(JSON.parse(`"${m[1]}"`), file);
    for (const m of text.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.set(m[1].replace(/\\'/g, "'"), file);
  }
  return keys;
}

test("every text the page shows has a French version", () => {
  const missing = [...keysInSource()].filter(([k]) => !(k in FR)).map(([k, f]) => `${f}: ${k}`);
  expect(missing).toEqual([]);
});

test("texts that reach t() through constants have a French version too", () => {
  const values = [
    ...Object.values(CRITERION_NAMES),
    ...Object.values(GOAL_IN_WORDS),
    ...Object.values(SUPPORT_LABEL),
    ...Object.values(STATE_WORDS),
    ...Object.values(CROP_LABELS),
    ...MONTH_NAMES,
    ...SHORT_MONTHS.filter((m) => m !== "May"), // "May" is the same key as the full month
    ...CAMERA_VIEWS.map((v) => v.label),
    ...SECTION_LINKS.map((s) => s.label),
    ...PRESETS.flatMap((p) => [p.label, p.summary]),
    ...["low", "moderate", "high"], // soil erodibility
    ...["fibrous", "taproot", "none"], // root architecture
    ...["crop", "planted", "cover", "bare"], // field state in the timeline
    ...["bu", "tonne", "ton"], // yield units
  ];
  expect(values.filter((v) => !(v in FR))).toEqual([]);
});

test("French keeps every placeholder of the English", () => {
  const broken = Object.entries(FR).filter(([en, fr]) => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    return names(en) !== names(fr);
  });
  expect(broken).toEqual([]);
});

test("English is the source text; French fills placeholders and writes numbers the French way", () => {
  expect(t("Your field")).toBe("Your field");
  setLang("fr");
  expect(t("Your field")).toBe(FR["Your field"]);
  expect(num(10.3)).toBe("10,3");
  expect(document.documentElement.lang).toBe("fr");
});

test("page text has no em dash (a colon or a full stop reads better)", () => {
  expect([...keysInSource().keys()].filter((k) => k.includes("—"))).toEqual([]);
});
