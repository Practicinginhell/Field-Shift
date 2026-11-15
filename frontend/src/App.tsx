import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { getLang, num, saveLang, savedLang, setLang, t, type Lang } from "./i18n";

import { analyze, fetchCropHistory, fetchCrops, fetchObserved } from "./api";
import ComparisonMatrix from "./ComparisonMatrix";
import MapView from "./MapView";
import MonthlyWaterChart from "./MonthlyWaterChart";
import PrioritySliders, { CRITERION_NAMES } from "./PrioritySliders";
import RotationEditor from "./RotationEditor";
import RotationList from "./RotationList";
import StrategyCard, { splitSharedLocalReview } from "./StrategyCard";
import YourCall, { type FarmerControl } from "./YourCall";
import YourNumbers from "./YourNumbers";
import AnswerCard from "./AnswerCard";
import { applyMargins, liveNumbers, type TypedNumbers } from "./margin";
import type {
  AnalyzeResponse,
  Criterion,
  CropNumbers,
  CropOption,
  Economics,
  ObservedField,
  Priorities,
  RotationYear,
  Strategy,
} from "./types";

// The 3D view pulls in three.js, so it loads only when results are shown.
const SeasonView = lazy(() => import("./SeasonView"));
const SatelliteReplay = lazy(() => import("./SatelliteReplay"));

interface Preset {
  label: string;
  summary: string;
  latitude: number;
  longitude: number;
  rotation: RotationYear[];
  irrigated: boolean;
}

const year = (crop: string): RotationYear => ({ crop, cover: false });
/** A year the crop map could not name: the farmer chooses it before comparing. */
const UNKNOWN_CROP = "";

export const PRESETS: Preset[] = [
  // Hamilton County field: corn 2022, soybeans 2023, corn 2024 in the USDA Cropland Data Layer.
  {
    label: "Iowa, corn and soybean",
    summary: "Rainfed Midwest loam · NASA + MODIS/SMAP replay",
    latitude: 42.38,
    longitude: -93.75,
    rotation: [year("corn"), year("soybean")],
    irrigated: false,
  },
  {
    label: "Nevada example, irrigated alfalfa",
    summary: "Arid high desert · heavy water tradeoff + replay",
    // CDL: alfalfa every year 2019–2024 at this point (a field interior).
    latitude: 39.465,
    longitude: -118.865,
    rotation: [year("alfalfa"), year("alfalfa"), year("alfalfa"), year("spring_wheat")],
    irrigated: true,
  },
  // AAFC Annual Crop Inventory: spring wheat 2020, then corn and soybeans alternating 2021–2025.
  {
    label: "Ottawa-area example, corn and soybean",
    summary: "Short frost-free season · Canadian AAFC + replay",
    latitude: 45.22,
    longitude: -75.8,
    rotation: [year("corn"), year("soybean")],
    irrigated: false,
  },
];

// "45.22° N, 75.80° W": easier to read than signed decimals.
export function formatPlace(latitude: number, longitude: number): string {
  const ns = latitude >= 0 ? "N" : "S";
  const ew = longitude >= 0 ? t("E") : t("W");
  // Two decimals always ("45.20°"), with a decimal comma in French.
  const fixed = (v: number) => {
    const text = Math.abs(v).toFixed(2);
    return getLang() === "fr" ? text.replace(".", ",") : text;
  };
  return `${fixed(latitude)}° ${ns}, ${fixed(longitude)}° ${ew}`;
}

/** Where the margin numbers come from, for the "Your call" box. */
function numbersSource(e: Economics, own: number): string {
  const yours = own ? (own > 1 ? t("your own for {n} crops", { n: own }) : t("your own for 1 crop")) : "";
  if (e.region) return t("{region} 2026 budget", { region: e.region }) + (yours ? `, ${yours}` : "");
  return yours ? yours[0].toUpperCase() + yours.slice(1) : t("No local budget: enter your own");
}

function summarizeGoals(priorities: Priorities): string {
  const ranked = (Object.entries(priorities) as [Criterion, number][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return t("None weighted");
  const topScore = ranked[0][1];
  const topNames = ranked.filter(([, v]) => v === topScore).map(([k]) => t(CRITERION_NAMES[k]));
  if (topNames.length <= 2) return topNames.join(", ");
  return `${topNames.slice(0, 2).join(", ")} +${topNames.length - 2}`;
}

const DEFAULT_PRIORITIES: Priorities = { water: 3, soil: 3, nitrogen: 2, erosion: 3, pests: 2, forage: 1, income: 3 };

type ThemeMode = "auto" | "light" | "dark";
type ResultSectionId = "sec-answer" | "sec-compare" | "sec-more";

export const SECTION_LINKS: { id: ResultSectionId; label: string }[] = [
  { id: "sec-answer", label: "Suggestion" },
  { id: "sec-compare", label: "Compare" },
  { id: "sec-more", label: "More detail" },
];

export default function App() {
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [latitude, setLatitude] = useState(PRESETS[0].latitude);
  const [longitude, setLongitude] = useState(PRESETS[0].longitude);
  const [rotation, setRotation] = useState<RotationYear[]>(PRESETS[0].rotation);
  const rotationIncomplete = rotation.some((y) => y.crop === UNKNOWN_CROP);
  const [irrigated, setIrrigated] = useState(PRESETS[0].irrigated);
  const [priorities, setPriorities] = useState<Priorities>(DEFAULT_PRIORITIES);
  const [excludedCrops, setExcludedCrops] = useState<string[]>([]);
  // The farmer's own yields, prices and costs; empty means the regional budget's.
  const [ownNumbers, setOwnNumbers] = useState<Record<string, CropNumbers>>({});
  const [ownCoverCost, setOwnCoverCost] = useState<number | null>(null);
  // What the farmer is typing in the numbers table; null shows the table as it came.
  const [typedNumbers, setTypedNumbers] = useState<TypedNumbers | null>(null);
  // Crops the farmer said they can grow and sell, so their question is not asked again.
  const [confirmedCrops, setConfirmedCrops] = useState<string[]>([]);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [observed, setObserved] = useState<ObservedField | null>(null);
  const [activeSeasonMonth, setActiveSeasonMonth] = useState<number | null>(null);
  const [chartMonthRequest, setChartMonthRequest] = useState<{ month: number; seq: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editingInputs, setEditingInputs] = useState(true);
  const [selectedDetailIds, setSelectedDetailIds] = useState<string[]>([]);
  const [highlightedStrategyId, setHighlightedStrategyId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<ResultSectionId>("sec-answer");
  const [theme, setTheme] = useState<ThemeMode>("auto");
  // English or French; i18n.ts holds the current one for t(), this state re-renders the page.
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = savedLang();
    setLang(saved);
    return saved;
  });
  const [error, setError] = useState<string | null>(null);
  const inputsRef = useRef<HTMLElement | null>(null);
  const moreRef = useRef<HTMLDetailsElement | null>(null);
  const prevEditingRef = useRef(editingInputs);

  useEffect(() => {
    const wasEditing = prevEditingRef.current;
    prevEditingRef.current = editingInputs;
    if (!wasEditing && editingInputs && result) {
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      inputsRef.current?.scrollIntoView?.({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
    }
  }, [editingInputs, result]);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Only the latest crop-history request may fill the rotation, and never over the
  // farmer's own edits made while it was loading.
  const historyRequest = useRef(0);
  const analyzeRequest = useRef(0);
  const editedSinceRequest = useRef(false);

  const cropNames = useMemo(() => Object.fromEntries(crops.map((c) => [c.key, c.name])), [crops]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
    return () => {
      delete root.dataset.theme;
    };
  }, [theme]);

  useEffect(() => {
    if (!result || typeof IntersectionObserver === "undefined") return;
    const elements = SECTION_LINKS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (elements.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveSection(visible[0].target.id as ResultSectionId);
        }
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: 0.05 },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [result]);

  const editRotation = (next: RotationYear[]) => {
    editedSinceRequest.current = true;
    setRotation(next);
    setDirty(true);
  };

  useEffect(() => {
    fetchCrops(getLang())
      .then(setCrops)
      .catch(() => setError(t("The server is not reachable. Start it with ./scripts/dev.")));
  }, []);

  const choosePreset = (p: Preset) => {
    historyRequest.current += 1; // ignore any crop history still loading
    analyzeRequest.current += 1; // and any comparison still running for the old field
    setBusy(false);
    setHistoryLoading(false);
    setLatitude(p.latitude);
    setLongitude(p.longitude);
    setOwnNumbers({}); // another farm: its own numbers, and maybe another currency
    setTypedNumbers(null);
    setOwnCoverCost(null);
    setRotation(p.rotation);
    setIrrigated(p.irrigated);
    setResult(null);
    setObserved(null);
    setDirty(false);
    setEditingInputs(true);
    setActiveSeasonMonth(null);
    setChartMonthRequest(null);
    setHistoryNote(null);
  };

  const pickField = (lat: number, lon: number) => {
    const latitude = Number(lat.toFixed(4));
    const longitude = Number(lon.toFixed(4));
    analyzeRequest.current += 1; // ignore any comparison still running for the old field
    setBusy(false);
    setLatitude(latitude);
    setLongitude(longitude);
    setOwnNumbers({});
    setTypedNumbers(null);
    setOwnCoverCost(null);
    setResult(null);
    setObserved(null);
    setDirty(false);
    setEditingInputs(true);
    setActiveSeasonMonth(null);
    setChartMonthRequest(null);
    void readCropHistory(latitude, longitude);
  };

  const isActivePreset = (p: Preset) => p.latitude === latitude && p.longitude === longitude;

  // Past crops from satellite crop maps: AAFC in Canada (about a second), USDA in the
  // U.S. (can take a minute). Called on every map click and by the "fill" button.
  const readCropHistory = async (lat: number, lon: number) => {
    const request = ++historyRequest.current;
    editedSinceRequest.current = false;
    setHistoryLoading(true);
    setHistoryNote(t("Reading this field's past crops from satellite crop maps… (U.S. fields can take a minute)"));
    const stillWanted = () => request === historyRequest.current;
    try {
      const history = await fetchCropHistory(lat, lon, getLang());
      if (!stillWanted()) return;
      const known = history.years.filter((y) => y.crop !== null);
      if (known.length === 0) {
        setHistoryNote(
          t("No crop map covers this point (we read U.S. and Canadian maps). The rotation below is unchanged: set it to what you grow."),
        );
        return;
      }
      const listed = history.years.map((y) => `${y.year}: ${(y.crop && cropNames[y.crop]) || (y.cdl_category ?? t("no answer"))}`).join(", ");
      if (editedSinceRequest.current) {
        setHistoryNote(t("Past crops from {source}: {listed}. Your own edits were kept.", { source: history.source, listed }));
        return;
      }
      // An unknown year stays as a blank for the farmer: dropping it would make the
      // years on either side look back to back (corn, ?, corn read as corn after corn).
      setRotation(history.years.map((y) => year(y.crop ?? UNKNOWN_CROP)));
      const unknown = history.years.filter((y) => y.crop === null).map((y) => y.year);
      const ask = unknown.length ? t(" What did you grow in {years}? Choose it below.", { years: unknown.join(` ${t("and")} `) }) : "";
      setHistoryNote(t("Filled from {source}: {listed}. Check it matches what you grew.", { source: history.source, listed }) + ask);
    } catch (e) {
      if (!stillWanted()) return;
      setHistoryNote(
        t("The crop map did not answer ({error}). The rotation below is unchanged: set it to what you grow.", {
          error: (e as Error).message,
        }),
      );
    } finally {
      if (stillWanted()) setHistoryLoading(false);
    }
  };

  const run = async (
    excluded: string[] = excludedCrops,
    own: Record<string, CropNumbers> = ownNumbers,
    coverCost: number | null = ownCoverCost,
  ) => {
    if (rotationIncomplete) return;
    // A field change while this runs makes the answer stale: only the latest request
    // may show its results.
    const request = ++analyzeRequest.current;
    const stillWanted = () => request === analyzeRequest.current;
    setBusy(true);
    setResult(null);
    setDirty(false);
    setError(null);
    setObserved(null);
    try {
      const res = await analyze({
        latitude,
        longitude,
        current_rotation: rotation,
        irrigated,
        priorities,
        excluded_crops: excluded,
        language: getLang(),
        own_numbers: own,
        own_cover_cost: coverCost,
      });
      if (!stillWanted()) return;
      const firstAlternative = res.strategies.find((s) => !s.is_baseline) ?? res.strategies[0];
      setResult(res);
      setTypedNumbers(null); // the new answer carries the farmer's numbers in its table
      setSelectedDetailIds(firstAlternative ? [firstAlternative.id] : []);
      setHighlightedStrategyId(firstAlternative?.id ?? null);
      setActiveSection("sec-answer");
      setEditingInputs(false);
      setActiveSeasonMonth(null);
      setChartMonthRequest(null);
      // Satellite replay exists for the example fields only; others simply don't get one.
      fetchObserved(latitude, longitude, getLang())
        .then((o) => stillWanted() && setObserved(o))
        .catch(() => stillWanted() && setObserved(null));
    } catch (e) {
      if (!stillWanted()) return;
      setError(t("Could not compare rotations: {error}", { error: (e as Error).message }));
      setEditingInputs(true);
    } finally {
      if (stillWanted()) setBusy(false);
    }
  };

  const selectDetailStrategy = (id: string) => {
    setHighlightedStrategyId(id);
    setSelectedDetailIds((prev) => {
      const secondary = prev.slice(1).find((x) => x !== id);
      return secondary ? [id, secondary] : [id];
    });
  };

  const toggleSecondDetail = (id: string) => {
    setSelectedDetailIds((prev) => {
      const primary = prev[0] ?? highlightedStrategyId ?? id;
      if (id === primary) return prev;
      if (prev.includes(id)) return [primary];
      return [primary, id];
    });
  };

  const ruleOutCrop = (key: string) => {
    const next = [...excludedCrops, key];
    setExcludedCrops(next);
    run(next);
  };

  // Margins don't change the scores, so typed numbers update them here, with no reload.
  const typeNumbers = (typed: TypedNumbers, own: Record<string, CropNumbers>, coverCost: number | null) => {
    setTypedNumbers(typed);
    setOwnNumbers(own);
    setOwnCoverCost(coverCost);
  };

  // Every text switches at once: the page's own (t), crop names, and the answer's sentences.
  const changeLanguage = (next: Lang) => {
    if (next === lang) return;
    setLang(next);
    saveLang(next);
    setLangState(next);
    fetchCrops(next)
      .then(setCrops)
      .catch(() => setError(t("The server is not reachable. Start it with ./scripts/dev.")));
    if (result) void run();
  };

  const openControl = (control: FarmerControl) => {
    if (control === "numbers") {
      // The numbers table sits in the results, next to the comparison it changes.
      const el = document.getElementById("control-numbers");
      if (el instanceof HTMLDetailsElement) el.open = true;
      el?.scrollIntoView?.({ block: "start" });
      el?.focus({ preventScroll: true });
      return;
    }
    setEditingInputs(true);
    // After the inputs re-open (and their own scroll), go to the one control.
    window.setTimeout(() => {
      const el = document.getElementById(`control-${control}`);
      if (el instanceof HTMLDetailsElement) el.open = true;
      el?.scrollIntoView?.({ block: "center" });
      el?.focus({ preventScroll: true });
    }, 0);
  };

  // An option's crops that are new to the farmer's rotation: only the farmer knows if
  // there is a buyer (or their own use) and the equipment for them.
  const cropQuestions = (s: Strategy) =>
    s.is_baseline
      ? []
      : [...new Set(s.years.map((y) => y.crop))]
          .filter((key) => key !== "fallow" && !rotation.some((y) => y.crop === key))
          .map((key) => ({ key, name: cropNames[key] ?? key.replaceAll("_", " "), confirmed: confirmedCrops.includes(key) }));

  // The suggestion's crops the farmer doesn't grow today: only they know the buyer and equipment.
  const topAlternative = result?.strategies.find((s) => !s.is_baseline);
  const topNewCrops = topAlternative ? cropQuestions(topAlternative).map((q) => q.name) : [];

  const seeWhy = (id: string) => {
    selectDetailStrategy(id);
    window.setTimeout(() => document.getElementById("detail-panels")?.scrollIntoView?.({ block: "start" }), 0);
  };

  // The rotations as shown: margins from the numbers table, with the farmer's typing.
  const shownStrategies = useMemo(() => {
    if (!result?.economics) return result?.strategies ?? [];
    const names = { ...cropNames, ...Object.fromEntries(result.economics.crops.map((c) => [c.crop, c.name])) };
    const live = liveNumbers(result.economics, typedNumbers);
    return applyMargins(result.strategies, live.numbers, live.coverCost, names);
  }, [result, typedNumbers, cropNames]);
  const shownBaseline = shownStrategies.find((s) => s.is_baseline) ?? shownStrategies[0];

  const showCollapsedInputs = Boolean(result) && !editingInputs;
  const baselineStrategy = result?.strategies.find((s) => s.is_baseline) ?? result?.strategies[0];
  const alternativeIndexMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!result) return map;
    let opt = 0;
    for (const s of result.strategies) {
      if (s.is_baseline) continue;
      opt += 1;
      map.set(s.id, t("Option {n}", { n: opt }));
    }
    return map;
  }, [result]);

  const { shared: sharedChecks, perStrategy: uniqueChecks } = useMemo(
    () => (result ? splitSharedLocalReview(result.strategies) : { shared: [], perStrategy: new Map<string, string[]>() }),
    [result],
  );

  const selectedStrategies = useMemo(() => {
    if (!result) return [];
    const byId = new Map(result.strategies.map((s) => [s.id, s]));
    const picked = selectedDetailIds.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
    if (picked.length > 0) return picked.slice(0, 2);
    const fallback = result.strategies.find((s) => !s.is_baseline) ?? result.strategies[0];
    return fallback ? [fallback] : [];
  }, [result, selectedDetailIds]);

  const rotationSummary = rotation
    .map((y) =>
      y.crop === UNKNOWN_CROP
        ? t("unknown")
        : `${cropNames[y.crop] ?? y.crop.replaceAll("_", " ")}${y.cover ? t(" + cover") : ""}`,
    )
    .join(" – ");

  return (
    <div className="page">
      <header className="top">
        <div className="top-main">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true" />
            <div>
              <div className="brand-row">
                <h1>Field Shift</h1>
              </div>
              <p className="brand-promise">
                {t("Explore crop rotations for your field with 20 years of NASA climate data and your own priorities.")}
              </p>
            </div>
          </div>
          <div className="theme-switch" role="group" aria-label={t("Language")}>
            {(["en", "fr"] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                lang={l}
                className={lang === l ? "theme-btn active" : "theme-btn"}
                aria-pressed={lang === l}
                aria-label={l === "en" ? "English" : "Français"}
                onClick={() => changeLanguage(l)}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="theme-switch" role="group" aria-label={t("Color theme")}>
            {(["auto", "light", "dark"] as ThemeMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={theme === mode ? "theme-btn active" : "theme-btn"}
                aria-pressed={theme === mode}
                onClick={() => setTheme(mode)}
              >
                {mode === "auto" ? t("Auto") : mode === "light" ? t("Light") : t("Dark")}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className={showCollapsedInputs ? "layout is-results-focused" : "layout"}>
        <section
          ref={inputsRef}
          className={showCollapsedInputs ? "inputs is-collapsed" : result ? "inputs is-reopened" : "inputs"}
          aria-label={t("Your field")}
        >
          <h2 className="step-heading">{t("1. Your field")}</h2>
          <div className="presets">
            {PRESETS.map((p) => {
              const active = isActivePreset(p);
              return (
                <button
                  key={p.label}
                  type="button"
                  className={active ? "preset-card active" : "preset-card"}
                  aria-label={t(p.label)}
                  aria-pressed={active}
                  onClick={() => choosePreset(p)}
                >
                  <strong className="preset-title">{t(p.label)}</strong>
                  <span className="preset-desc">{t(p.summary)}</span>
                </button>
              );
            })}
          </div>
          <MapView latitude={latitude} longitude={longitude} onPick={pickField} />
          <p className="hint">
            {t("Your field (the pin):")} <strong>{formatPlace(latitude, longitude)}</strong>.{" "}
            {t("Click the map to move it, and we then read its past crops.")}
          </p>

          <h2 className="step-heading">{t("2. What you grow")}</h2>
          {crops.length > 0 && <RotationEditor crops={crops} rotation={rotation} onChange={editRotation} />}
          <button
            type="button"
            className="secondary crop-fill-btn"
            disabled={historyLoading}
            onClick={() => void readCropHistory(latitude, longitude)}
          >
            {t("Fill from past crop maps (U.S. and Canada)")}
          </button>
          {historyNote && (
            <p className={historyLoading ? "hint status-box is-loading" : "hint status-box"} aria-live="polite">
              {historyNote}
            </p>
          )}

          <h2 className="step-heading">{t("3. Your farm")}</h2>
          <h3 id="control-priorities" tabIndex={-1} className="sub-heading">
            {t("What matters most to you")}
          </h3>
          <PrioritySliders
            priorities={priorities}
            onChange={(next) => {
              setPriorities(next);
              setDirty(true);
            }}
          />
          <h3 className="sub-heading">{t("Your water and your limits")}</h3>
          <label id="control-water" tabIndex={-1} className={irrigated ? "check toggle-card is-active" : "check toggle-card"}>
            <input
              type="checkbox"
              checked={irrigated}
              onChange={(e) => {
                setIrrigated(e.target.checked);
                setDirty(true);
              }}
            />
            <span className="toggle-card-label">{t("This field is irrigated")}</span>
          </label>
          <details id="control-crops" tabIndex={-1} className="excluded">
            <summary>
              <span className="excluded-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="8" cy="8" r="5.6" />
                  <path d="M4.2 11.8 11.8 4.2" />
                </svg>
              </span>
              <span className="excluded-copy">
                <span className="excluded-label">{t("Crops you can't grow or sell here")}</span>
                <span className="excluded-sub">{t("No buyer or equipment")}</span>
              </span>
              <span className="excluded-trailing">
                {excludedCrops.length > 0 && <span className="excluded-count">{t("{n} ruled out", { n: excludedCrops.length })}</span>}
                <span className="excluded-chev" aria-hidden="true">
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </span>
              </span>
            </summary>
            <div className="excluded-crops">
              {crops
                .filter((c) => c.key !== "fallow")
                .map((c) => (
                  <label key={c.key} className="check">
                    <input
                      type="checkbox"
                      checked={excludedCrops.includes(c.key)}
                      onChange={(e) => {
                        setExcludedCrops(
                          e.target.checked ? [...excludedCrops, c.key] : excludedCrops.filter((k) => k !== c.key),
                        );
                        setDirty(true);
                      }}
                    />
                    {c.name}
                  </label>
                ))}
            </div>
          </details>

          <button type="button" className="primary" onClick={() => run()} disabled={busy || crops.length === 0 || rotationIncomplete}>
            <span className="primary-cta-text">{busy ? t("Reading NASA data…") : t("Compare rotations")}</span>
            {!busy && (
              <span className="primary-cta-arrow" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 8h9" />
                  <path d="M9 4.5 12.5 8 9 11.5" />
                </svg>
              </span>
            )}
          </button>
          {rotationIncomplete && <p className="hint">{t("Choose a crop for every year in your rotation to compare.")}</p>}
          {error && (
            <div className="error-card" role="alert">
              <p>{error}</p>
              <p className="hint">
                {t("Confirm the backend server is running ({cmd}) or select another field, then try again.", { cmd: "./scripts/dev" })}
              </p>
            </div>
          )}
        </section>

        <section className="results" aria-label={t("Results")} aria-live="polite">
          {busy && (
            <div className="loading-panel" aria-busy="true">
              <p className="loading-status" role="status" aria-label={t("Comparison status")}>
                {t("Reading NASA POWER 20-year climate, checking local soil maps, and comparing crop rotations…")}
              </p>
              <div className="skeleton-kpis" aria-hidden="true">
                <div className="skeleton-box" />
                <div className="skeleton-box" />
                <div className="skeleton-box" />
                <div className="skeleton-box" />
              </div>
              <div className="skeleton-card" aria-hidden="true" />
              <div className="skeleton-card is-tall" aria-hidden="true" />
            </div>
          )}

          {!result && !busy && (
            <div className="intro-card">
              <p className="kind">{t("Field-level rotation comparison")}</p>
              <h2>{t("How it works")}</h2>
              <p>
                {t(
                  "Pick a field, tell us your current rotation and what matters to you. The tool reads 20 years of NASA POWER climate data for the area, and U.S. or Canadian soil maps where they exist. It then compares your rotation with other options and shows the evidence behind each one.",
                )}
              </p>
              <ol className="intro-steps">
                <li>
                  <strong>{t("1. Locate your field")}</strong>
                  <span>{t("Choose one of the three example fields or click your own field on the map.")}</span>
                </li>
                <li>
                  <strong>{t("2. What you grow")}</strong>
                  <span>{t("Enter the crops you grow, year by year, or fill them in from past crop maps.")}</span>
                </li>
                <li>
                  <strong>{t("3. Tell us about your farm")}</strong>
                  <span>{t("What matters most, your water, and crops you can't grow or sell.")}</span>
                </li>
              </ol>
              <div className="intro-preview" aria-label={t("What your comparison includes")}>
                <span>{t("What you get:")}</span>
                <ul>
                  <li>{t("Your field's rain, frost-free season and soil")}</li>
                  <li>{t("Other rotations compared with yours: what each is better and worse for, and what to check locally")}</li>
                  <li>{t("Your field through the seasons, and what satellites saw on it")}</li>
                </ul>
              </div>
              <p className="intro-decision-line">
                {t(
                  "It suggests options to explore. You decide, with the people who know your area: your extension office, agronomist or crop advisor.",
                )}
              </p>
            </div>
          )}

          {result && !busy && (
            <>
              <div className="sticky-results-bar">
                <div className="summary-bar">
                  <div className="summary-chips">
                    <span className="summary-chip">
                      <small>{t("Field")}</small>
                      <strong>{formatPlace(result.latitude, result.longitude)}</strong>
                    </span>
                    <span className="summary-chip">
                      <small>{t("Rotation")}</small>
                      <strong>{rotationSummary}</strong>
                    </span>
                    <span className="summary-chip">
                      <small>{t("Water")}</small>
                      <strong>{irrigated ? t("Irrigated") : t("Rainfed")}</strong>
                    </span>
                    <span className="summary-chip">
                      <small>{t("Goals")}</small>
                      <strong>{summarizeGoals(priorities)}</strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    className={editingInputs ? "secondary summary-edit-btn active" : "secondary summary-edit-btn"}
                    aria-expanded={editingInputs}
                    title={
                      editingInputs
                        ? t("Hide field, rotation, and priority controls")
                        : t("Open field map, crop rotation, and priority sliders")
                    }
                    onClick={() => setEditingInputs((open) => !open)}
                  >
                    <svg className="edit-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path
                        d="M11.6 2.2a1.4 1.4 0 0 1 2 2L5.5 12.3l-3 .8.8-3 8.3-7.9Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>{editingInputs ? t("Done editing") : t("Edit field & goals")}</span>
                  </button>
                </div>

                <nav className="section-nav" aria-label={t("Result sections")}>
                  {SECTION_LINKS.map((sec) => (
                    <a
                      key={sec.id}
                      href={`#${sec.id}`}
                      className={activeSection === sec.id ? "nav-pill active" : "nav-pill"}
                      onClick={() => {
                        if (sec.id === "sec-more" && moreRef.current) moreRef.current.open = true;
                        setActiveSection(sec.id);
                      }}
                    >
                      {t(sec.label)}
                    </a>
                  ))}
                </nav>

                {dirty && (
                  <div className="stale-banner" role="status">
                    <span>{t("Your rotation or priorities changed since this comparison.")}</span>
                    <button type="button" className="secondary active" onClick={() => run()}>
                      {t("Update comparison")}
                    </button>
                  </div>
                )}
              </div>

              <div className="results-stack">
                <section id="sec-answer" className="result-section">
                  {shownBaseline && (
                    <AnswerCard
                      baseline={shownBaseline}
                      top={shownStrategies.find((x) => !x.is_baseline)}
                      firstStep={shownStrategies.find((x) => x.id === "current-plus-cover")}
                      currency={result.economics?.currency}
                      newCrops={topNewCrops}
                      checks={topAlternative ? (uniqueChecks.get(topAlternative.id) ?? []) : []}
                      onSeeWhy={seeWhy}
                    />
                  )}
                </section>

                <section id="sec-compare" className="result-section">
                  <h2>{t("All options side by side")}</h2>
                  <p className="hint">
                    {t(
                      "Compared with your current rotation, on the goals you rated. These are options to explore, not recommendations.",
                    )}
                  </p>
                  <YourCall
                    goals={summarizeGoals(priorities)}
                    irrigated={irrigated}
                    ruledOut={excludedCrops.map((k) => cropNames[k] ?? k)}
                    numbersSource={result.economics ? numbersSource(result.economics, Object.keys(ownNumbers).length) : undefined}
                    onOpen={openControl}
                  />
                  {result.economics && <YourNumbers economics={result.economics} onChange={typeNumbers} />}
                  <RotationList
                    strategies={shownStrategies}
                    weights={result.weights}
                    currency={result.economics?.currency}
                    irrigated={irrigated}
                    selectedId={selectedStrategies[0]?.id ?? null}
                    onSelectStrategy={selectDetailStrategy}
                  />
                  <details className="all-scores">
                    <summary>{t("Show all scores")}</summary>
                    <ComparisonMatrix
                      strategies={result.strategies}
                      weights={result.weights}
                      selectedIds={selectedStrategies.map((s) => s.id)}
                      highlightedId={highlightedStrategyId}
                      onSelectStrategy={selectDetailStrategy}
                      onToggleSecond={toggleSecondDetail}
                      irrigated={irrigated}
                    />
                  </details>

                  <div id="detail-panels" className="detail-panels" data-count={selectedStrategies.length}>
                    {selectedStrategies.map((s) => (
                      <StrategyCard
                        key={s.id}
                        strategy={s}
                        variant="detail"
                        cropNames={cropNames}
                        optionPrefix={alternativeIndexMap.get(s.id)}
                        baselineScores={baselineStrategy?.scores}
                        localChecks={uniqueChecks.get(s.id)}
                        cropQuestions={cropQuestions(s)}
                        onCropAnswer={(key, canGrow) =>
                          canGrow ? setConfirmedCrops((prev) => [...prev, key]) : ruleOutCrop(key)
                        }
                      />
                    ))}
                  </div>

                  {sharedChecks.length > 0 && (
                    <div className="shared-review-card">
                      <h3>{t("Check locally for any change")}</h3>
                      <ul>
                        {sharedChecks.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {result.removed.length > 0 && (
                    <details className="removed">
                      <summary>{t("Options ruled out for this field ({n})", { n: result.removed.length })}</summary>
                      <ul>
                        {result.removed.map((r) => (
                          <li key={r.name}>
                            <strong>{r.name}:</strong> {r.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>

                <details
                  id="sec-more"
                  ref={moreRef}
                  className="result-section more-detail"
                >
                  <summary>
                    <span className="more-title">{t("More detail for you and your advisor")}</span>
                    <span className="more-sub">
                      {t(
                        "Your field's weather and soil, every option through the seasons in 3D, and what satellites saw on the field.",
                      )}
                    </span>
                  </summary>
                <section id="sec-conditions" className="result-section">
                  <h2>{t("Your field's conditions ({period})", { period: result.conditions.period })}</h2>
                  <div className="conditions-kpis">
                    <div className="kpi">
                      <span className="kpi-label">{t("Rain a year")}</span>
                      <strong className="kpi-value">{result.conditions.annual_precip_mm} mm</strong>
                    </div>
                    <div className="kpi">
                      <span className="kpi-label">{t("Frost-free season")}</span>
                      <strong className="kpi-value">{t("{n} days", { n: result.conditions.frost_free_days })}</strong>
                    </div>
                    <div className="kpi">
                      <span className="kpi-label">{t("Soil")}</span>
                      <strong className="kpi-value">{result.conditions.soil?.component ?? t("No soil map here")}</strong>
                    </div>
                    {result.conditions.erosion_susceptibility !== "unknown" && (
                      <div className="kpi">
                        <span className="kpi-label">{t("Soil erodibility")}</span>
                        <strong className="kpi-value">
                          {t(result.conditions.erosion_susceptibility)}
                          {result.conditions.soil?.slope_percent != null &&
                            t(" (slope {pct}%)", { pct: num(result.conditions.soil.slope_percent) })}
                        </strong>
                      </div>
                    )}
                  </div>
                  <div className="conditions">
                    <ul>
                      {result.conditions.summary.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                    <MonthlyWaterChart
                      rain={result.conditions.monthly_precip_mm}
                      et0={result.conditions.monthly_et0_mm}
                      selectedMonth={activeSeasonMonth}
                      onSelectMonth={(m) => {
                        setActiveSeasonMonth(m);
                        setChartMonthRequest((prev) => ({ month: m, seq: (prev?.seq ?? 0) + 1 }));
                      }}
                    />
                  </div>
                </section>

                <section id="sec-seasons" className="result-section">
                  <Suspense fallback={<p className="hint">{t("Loading the 3D season view…")}</p>}>
                    <SeasonView
                      strategies={result.strategies}
                      conditions={result.conditions}
                      latitude={result.latitude}
                      cropNames={cropNames}
                      selectedMonthRequest={chartMonthRequest}
                      highlightedStrategyId={highlightedStrategyId}
                      onSelectStrategy={selectDetailStrategy}
                      onActiveMonthChange={setActiveSeasonMonth}
                    />
                  </Suspense>
                </section>

                <section id="sec-space" className="result-section">
                  {observed ? (
                    <Suspense fallback={<p className="hint">{t("Loading the satellite replay…")}</p>}>
                      <SatelliteReplay
                        field={observed}
                        conditions={result.conditions}
                        latitude={result.latitude}
                        cropNames={cropNames}
                      />
                    </Suspense>
                  ) : (
                    <div className="no-replay-card">
                      <p className="kind">{t("MODIS & SMAP record")}</p>
                      <h3>{t("No prepared satellite replay for custom points")}</h3>
                      <p className="hint">
                        {t(
                          "Full multi-year MODIS NDVI and SMAP soil-moisture replays are bundled for the three example fields. Custom coordinates use live 20-year NASA POWER climate and regional soil lookups above.",
                        )}
                      </p>
                      <div className="no-replay-actions">
                        {PRESETS.map((p) => (
                          <button key={p.label} type="button" className="secondary" onClick={() => choosePreset(p)}>
                            {t("Load {label}", { label: t(p.label) })}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>

                </details>

                <div className="notes">
                  {result.notes.map((n) => (
                    <p key={n}>{n}</p>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
      <footer>
        {t(
          "Data: NASA POWER (NASA Langley Research Center), USDA NRCS SSURGO, USDA NASS Cropland Data Layer, Agriculture and Agri-Food Canada (Annual Crop Inventory, Soil Landscape Grids, under the Open Government Licence – Canada). Crop values: FAO-56. Map © OpenStreetMap contributors.",
        )}
      </footer>
    </div>
  );
}
