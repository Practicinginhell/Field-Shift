import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { analyze, fetchCropHistory, fetchCrops, fetchObserved } from "./api";
import ComparisonMatrix from "./ComparisonMatrix";
import MapView from "./MapView";
import MonthlyWaterChart from "./MonthlyWaterChart";
import PrioritySliders, { CRITERION_NAMES } from "./PrioritySliders";
import RotationEditor from "./RotationEditor";
import RotationList from "./RotationList";
import StrategyCard, { splitSharedLocalReview } from "./StrategyCard";
import YourCall, { type FarmerControl } from "./YourCall";
import type {
  AnalyzeResponse,
  Criterion,
  CropOption,
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
  const ew = longitude >= 0 ? "E" : "W";
  return `${Math.abs(latitude).toFixed(2)}° ${ns}, ${Math.abs(longitude).toFixed(2)}° ${ew}`;
}

function summarizeGoals(priorities: Priorities): string {
  const ranked = (Object.entries(priorities) as [Criterion, number][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return "None weighted";
  const topScore = ranked[0][1];
  const topNames = ranked.filter(([, v]) => v === topScore).map(([k]) => CRITERION_NAMES[k]);
  if (topNames.length <= 2) return topNames.join(", ");
  return `${topNames.slice(0, 2).join(", ")} +${topNames.length - 2}`;
}

const DEFAULT_PRIORITIES: Priorities = { water: 3, soil: 3, nitrogen: 2, erosion: 3, pests: 2, forage: 1, income: 3 };

type ThemeMode = "auto" | "light" | "dark";
type ResultSectionId = "sec-conditions" | "sec-compare" | "sec-seasons" | "sec-space";

const SECTION_LINKS: { id: ResultSectionId; label: string }[] = [
  { id: "sec-conditions", label: "Conditions" },
  { id: "sec-compare", label: "Compare" },
  { id: "sec-seasons", label: "Seasons" },
  { id: "sec-space", label: "From space" },
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
  const [activeSection, setActiveSection] = useState<ResultSectionId>("sec-conditions");
  const [theme, setTheme] = useState<ThemeMode>("auto");
  const [error, setError] = useState<string | null>(null);
  const inputsRef = useRef<HTMLElement | null>(null);
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
    fetchCrops()
      .then(setCrops)
      .catch(() => setError("The server is not reachable. Start it with ./scripts/dev."));
  }, []);

  const choosePreset = (p: Preset) => {
    historyRequest.current += 1; // ignore any crop history still loading
    analyzeRequest.current += 1; // and any comparison still running for the old field
    setBusy(false);
    setHistoryLoading(false);
    setLatitude(p.latitude);
    setLongitude(p.longitude);
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
    setHistoryNote("Reading this field's past crops from satellite crop maps… (U.S. fields can take a minute)");
    const stillWanted = () => request === historyRequest.current;
    try {
      const history = await fetchCropHistory(lat, lon);
      if (!stillWanted()) return;
      const known = history.years.filter((y) => y.crop !== null);
      if (known.length === 0) {
        setHistoryNote(
          "No crop map covers this point (we read U.S. and Canadian maps). The rotation below is unchanged: set it to what you grow.",
        );
        return;
      }
      const listed = history.years.map((y) => `${y.year}: ${y.cdl_category ?? "no answer"}`).join(", ");
      if (editedSinceRequest.current) {
        setHistoryNote(`Past crops from ${history.source}: ${listed}. Your own edits were kept.`);
        return;
      }
      // An unknown year stays as a blank for the farmer: dropping it would make the
      // years on either side look back to back (corn, ?, corn read as corn after corn).
      setRotation(history.years.map((y) => year(y.crop ?? UNKNOWN_CROP)));
      const unknown = history.years.filter((y) => y.crop === null).map((y) => y.year);
      const ask = unknown.length ? ` What did you grow in ${unknown.join(" and ")}? Choose it below.` : "";
      setHistoryNote(`Filled from ${history.source}: ${listed}. Check it matches what you grew.${ask}`);
    } catch (e) {
      if (!stillWanted()) return;
      setHistoryNote(`The crop map did not answer (${(e as Error).message}). The rotation below is unchanged: set it to what you grow.`);
    } finally {
      if (stillWanted()) setHistoryLoading(false);
    }
  };

  const run = async (excluded: string[] = excludedCrops) => {
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
      });
      if (!stillWanted()) return;
      const firstAlternative = res.strategies.find((s) => !s.is_baseline) ?? res.strategies[0];
      setResult(res);
      setSelectedDetailIds(firstAlternative ? [firstAlternative.id] : []);
      setHighlightedStrategyId(firstAlternative?.id ?? null);
      setActiveSection("sec-conditions");
      setEditingInputs(false);
      setActiveSeasonMonth(null);
      setChartMonthRequest(null);
      // Satellite replay exists for the example fields only; others simply don't get one.
      fetchObserved(latitude, longitude)
        .then((o) => stillWanted() && setObserved(o))
        .catch(() => stillWanted() && setObserved(null));
    } catch (e) {
      if (!stillWanted()) return;
      setError(`Could not compare rotations: ${(e as Error).message}`);
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

  const openControl = (control: FarmerControl) => {
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

  const showCollapsedInputs = Boolean(result) && !editingInputs;
  const baselineStrategy = result?.strategies.find((s) => s.is_baseline) ?? result?.strategies[0];
  const alternativeIndexMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!result) return map;
    let opt = 0;
    for (const s of result.strategies) {
      if (s.is_baseline) continue;
      opt += 1;
      map.set(s.id, `Option ${opt}`);
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
      y.crop === UNKNOWN_CROP ? "unknown" : `${cropNames[y.crop] ?? y.crop.replaceAll("_", " ")}${y.cover ? " + cover" : ""}`,
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
                Explore crop rotations for your field with 20 years of NASA climate data and your own priorities.
              </p>
            </div>
          </div>
          <div className="theme-switch" role="group" aria-label="Color theme">
            {(["auto", "light", "dark"] as ThemeMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={theme === mode ? "theme-btn active" : "theme-btn"}
                aria-pressed={theme === mode}
                onClick={() => setTheme(mode)}
              >
                {mode === "auto" ? "Auto" : mode === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className={showCollapsedInputs ? "layout is-results-focused" : "layout"}>
        <section
          ref={inputsRef}
          className={showCollapsedInputs ? "inputs is-collapsed" : result ? "inputs is-reopened" : "inputs"}
          aria-label="Your field"
        >
          <h2 className="step-heading">1. Your field</h2>
          <div className="presets">
            {PRESETS.map((p) => {
              const active = isActivePreset(p);
              return (
                <button
                  key={p.label}
                  type="button"
                  className={active ? "preset-card active" : "preset-card"}
                  aria-label={p.label}
                  aria-pressed={active}
                  onClick={() => choosePreset(p)}
                >
                  <strong className="preset-title">{p.label}</strong>
                  <span className="preset-desc">{p.summary}</span>
                </button>
              );
            })}
          </div>
          <MapView latitude={latitude} longitude={longitude} onPick={pickField} />
          <p className="hint">
            Your field (the pin): <strong>{formatPlace(latitude, longitude)}</strong>. Click the map to move it, and we
            then read its past crops.
          </p>

          <h2 className="step-heading">2. Your current rotation</h2>
          {crops.length > 0 && <RotationEditor crops={crops} rotation={rotation} onChange={editRotation} />}
          <button
            type="button"
            className="secondary crop-fill-btn"
            disabled={historyLoading}
            onClick={() => void readCropHistory(latitude, longitude)}
          >
            Fill from past crop maps (U.S. and Canada)
          </button>
          {historyNote && (
            <p className={historyLoading ? "hint status-box is-loading" : "hint status-box"} aria-live="polite">
              {historyNote}
            </p>
          )}
          <label id="control-water" tabIndex={-1} className={irrigated ? "check toggle-card is-active" : "check toggle-card"}>
            <input
              type="checkbox"
              checked={irrigated}
              onChange={(e) => {
                setIrrigated(e.target.checked);
                setDirty(true);
              }}
            />
            <span className="toggle-card-label">This field is irrigated</span>
          </label>

          <h2 id="control-priorities" tabIndex={-1} className="step-heading">
            3. What matters most to you
          </h2>
          <PrioritySliders
            priorities={priorities}
            onChange={(next) => {
              setPriorities(next);
              setDirty(true);
            }}
          />
          <details id="control-crops" tabIndex={-1} className="excluded">
            <summary>
              <span className="excluded-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="8" cy="8" r="5.6" />
                  <path d="M4.2 11.8 11.8 4.2" />
                </svg>
              </span>
              <span className="excluded-copy">
                <span className="excluded-label">Crops you can't grow or sell here</span>
                <span className="excluded-sub">No buyer or equipment</span>
              </span>
              <span className="excluded-trailing">
                {excludedCrops.length > 0 && <span className="excluded-count">{excludedCrops.length} ruled out</span>}
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
            <span className="primary-cta-text">{busy ? "Reading NASA data…" : "Compare rotations"}</span>
            {!busy && (
              <span className="primary-cta-arrow" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 8h9" />
                  <path d="M9 4.5 12.5 8 9 11.5" />
                </svg>
              </span>
            )}
          </button>
          {rotationIncomplete && <p className="hint">Choose a crop for every year in your rotation to compare.</p>}
          {error && (
            <div className="error-card" role="alert">
              <p>{error}</p>
              <p className="hint">
                Confirm the backend server is running (<code>./scripts/dev</code>) or select another field, then try
                again.
              </p>
            </div>
          )}
        </section>

        <section className="results" aria-label="Results" aria-live="polite">
          {busy && (
            <div className="loading-panel" aria-busy="true">
              <p className="loading-status" role="status" aria-label="Comparison status">
                Reading NASA POWER 20-year climate, checking local soil maps, and comparing crop rotations…
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
              <p className="kind">Field-level rotation comparison</p>
              <h2>How it works</h2>
              <p>
                Pick a field, tell us your current rotation and what matters to you. The tool reads 20 years of NASA
                POWER climate data for the area, and U.S. or Canadian soil maps where they exist. It then compares your
                rotation with other options and shows the evidence behind each one.
              </p>
              <ol className="intro-steps">
                <li>
                  <strong>1. Locate your field</strong>
                  <span>Choose one of the three example fields or click your own field on the map.</span>
                </li>
                <li>
                  <strong>2. Set current rotation &amp; irrigation</strong>
                  <span>Enter the crops you grow, year by year, or fill them in from past crop maps.</span>
                </li>
                <li>
                  <strong>3. Weight your priorities</strong>
                  <span>Say how much water, soil, erosion, pests, livestock feed and markets matter to you.</span>
                </li>
              </ol>
              <div className="intro-preview" aria-label="What your comparison includes">
                <span>What you get:</span>
                <ul>
                  <li>Your field's rain, frost-free season and soil</li>
                  <li>Other rotations compared with yours: what each is better and worse for, and what to check locally</li>
                  <li>Your field through the seasons, and what satellites saw on it</li>
                </ul>
              </div>
              <p className="intro-decision-line">
                It suggests options to explore. You decide, with the people who know your area: your extension office,
                agronomist or crop advisor.
              </p>
            </div>
          )}

          {result && !busy && (
            <>
              <div className="sticky-results-bar">
                <div className="summary-bar">
                  <div className="summary-chips">
                    <span className="summary-chip">
                      <small>Field</small>
                      <strong>{formatPlace(result.latitude, result.longitude)}</strong>
                    </span>
                    <span className="summary-chip">
                      <small>Rotation</small>
                      <strong>{rotationSummary}</strong>
                    </span>
                    <span className="summary-chip">
                      <small>Water</small>
                      <strong>{irrigated ? "Irrigated" : "Rainfed"}</strong>
                    </span>
                    <span className="summary-chip">
                      <small>Goals</small>
                      <strong>{summarizeGoals(priorities)}</strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    className={editingInputs ? "secondary summary-edit-btn active" : "secondary summary-edit-btn"}
                    aria-expanded={editingInputs}
                    title={
                      editingInputs
                        ? "Hide field, rotation, and priority controls"
                        : "Open field map, crop rotation, and priority sliders"
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
                    <span>{editingInputs ? "Done editing" : "Edit field & goals"}</span>
                  </button>
                </div>

                <nav className="section-nav" aria-label="Result sections">
                  {SECTION_LINKS.map((sec) => (
                    <a
                      key={sec.id}
                      href={`#${sec.id}`}
                      className={activeSection === sec.id ? "nav-pill active" : "nav-pill"}
                      onClick={() => setActiveSection(sec.id)}
                    >
                      {sec.label}
                    </a>
                  ))}
                </nav>

                {dirty && (
                  <div className="stale-banner" role="status">
                    <span>Your rotation or priorities changed since this comparison.</span>
                    <button type="button" className="secondary active" onClick={() => run()}>
                      Update comparison
                    </button>
                  </div>
                )}
              </div>

              <div className="results-stack">
                <section id="sec-conditions" className="result-section">
                  <h2>Your field's conditions ({result.conditions.period})</h2>
                  <div className="conditions-kpis">
                    <div className="kpi">
                      <span className="kpi-label">Rain a year</span>
                      <strong className="kpi-value">{result.conditions.annual_precip_mm} mm</strong>
                    </div>
                    <div className="kpi">
                      <span className="kpi-label">Frost-free season</span>
                      <strong className="kpi-value">{result.conditions.frost_free_days} days</strong>
                    </div>
                    <div className="kpi">
                      <span className="kpi-label">Soil</span>
                      <strong className="kpi-value">{result.conditions.soil?.component ?? "No soil map here"}</strong>
                    </div>
                    {result.conditions.erosion_susceptibility !== "unknown" && (
                      <div className="kpi">
                        <span className="kpi-label">Erosion risk</span>
                        <strong className="kpi-value">{result.conditions.erosion_susceptibility}</strong>
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

                <section id="sec-compare" className="result-section">
                  <h2>Rotations compared</h2>
                  <p className="hint">
                    Compared with your current rotation, on the goals you rated. These are options to explore, not
                    recommendations.
                  </p>
                  <YourCall
                    goals={summarizeGoals(priorities)}
                    irrigated={irrigated}
                    ruledOut={excludedCrops.map((k) => cropNames[k] ?? k)}
                    onOpen={openControl}
                  />
                  <RotationList
                    strategies={result.strategies}
                    weights={result.weights}
                    selectedId={selectedStrategies[0]?.id ?? null}
                    onSelectStrategy={selectDetailStrategy}
                  />
                  <details className="all-scores">
                    <summary>Show all scores</summary>
                    <ComparisonMatrix
                      strategies={result.strategies}
                      weights={result.weights}
                      selectedIds={selectedStrategies.map((s) => s.id)}
                      highlightedId={highlightedStrategyId}
                      onSelectStrategy={selectDetailStrategy}
                      onToggleSecond={toggleSecondDetail}
                    />
                  </details>

                  <div className="detail-panels" data-count={selectedStrategies.length}>
                    {selectedStrategies.map((s) => (
                      <StrategyCard
                        key={s.id}
                        strategy={s}
                        variant="detail"
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
                      <h3>Check locally for any change</h3>
                      <ul>
                        {sharedChecks.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {result.removed.length > 0 && (
                    <details className="removed">
                      <summary>Options ruled out for this field ({result.removed.length})</summary>
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

                <section id="sec-seasons" className="result-section">
                  <Suspense fallback={<p className="hint">Loading the 3D season view…</p>}>
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
                    <Suspense fallback={<p className="hint">Loading the satellite replay…</p>}>
                      <SatelliteReplay
                        field={observed}
                        conditions={result.conditions}
                        latitude={result.latitude}
                        cropNames={cropNames}
                      />
                    </Suspense>
                  ) : (
                    <div className="no-replay-card">
                      <p className="kind">MODIS &amp; SMAP record</p>
                      <h3>No prepared satellite replay for custom points</h3>
                      <p className="hint">
                        Full multi-year MODIS NDVI and SMAP soil-moisture replays are bundled for the three example
                        fields. Custom coordinates use live 20-year NASA POWER climate and regional soil lookups above.
                      </p>
                      <div className="no-replay-actions">
                        {PRESETS.map((p) => (
                          <button key={p.label} type="button" className="secondary" onClick={() => choosePreset(p)}>
                            Load {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>

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
        Data: NASA POWER (NASA Langley Research Center), USDA NRCS SSURGO, USDA NASS Cropland Data Layer, Agriculture
        and Agri-Food Canada (Annual Crop Inventory, Soil Landscape Grids, under the Open Government Licence – Canada). Crop
        values: FAO-56. Map © OpenStreetMap contributors.
      </footer>
    </div>
  );
}
