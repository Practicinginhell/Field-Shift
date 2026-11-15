// English or French for every word the page shows. English text is the key, so the
// English page is exactly the source text; French comes from fr.ts. The backend writes
// its own sentences in the chosen language (`language` / `lang` on each API call).
//
// `t` reads the current language from this module. Switching language re-renders the
// whole app from App, so components and helpers (season.ts, observed.ts) can call `t`
// without passing anything down.

import { FR } from "./fr";

export type Lang = "en" | "fr";

let current: Lang = "en";

export function setLang(lang: Lang): void {
  current = lang;
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

export function getLang(): Lang {
  return current;
}

/** The text in the current language, with `{name}` placeholders filled from `vars`. */
export function t(en: string, vars?: Record<string, string | number>): string {
  const text = current === "fr" ? (FR[en] ?? en) : en;
  return vars ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : text;
}

/** A number as people write it in the current language: 10.3 → "10,3" in French. */
export function num(value: number): string {
  return value.toLocaleString(current === "fr" ? "fr-CA" : "en-US", { maximumFractionDigits: 2 });
}

const STORAGE_KEY = "field-shift-lang";

/** The language saved from the last visit, else the browser's, else English. */
export function savedLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "fr") return saved;
  } catch {
    // Storage blocked (private window): fall through to the browser's language.
  }
  return typeof navigator !== "undefined" && navigator.language?.startsWith("fr") ? "fr" : "en";
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not remembered next time; the page still works.
  }
}
