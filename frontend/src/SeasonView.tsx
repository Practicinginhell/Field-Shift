// "Watch the seasons": the current rotation and one option, side by side in 3D, played
// month by month. Loaded lazily, so the 3D library only downloads when results show.

import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { ACESFilmicToneMapping } from "three";
import { getLang, num, t } from "./i18n";

import FieldScene, { erosionRisk } from "./FieldScene";
import {
  type CameraView,
  compareTally,
  cycleYears,
  describe,
  HEAVY_RAIN_MONTH,
  keyMoments,
  MONTH_NAMES,
  plotFrame,
  rootProfile,
  ROOTS_SOIL_EXAGGERATION,
  SHORT_MONTHS,
  tally,
  waterBalance,
  weatherFrame,
  yearCropLabel,
} from "./season";
import type { Conditions, Strategy } from "./types";

const STEP_MS = 1100;

export const CAMERA_VIEWS: { mode: CameraView; label: string }[] = [
  { mode: "overview", label: "Overview" },
  { mode: "roots", label: "Soil & roots" },
  { mode: "canopy", label: "Top-down canopy" },
];

interface Props {
  strategies: Strategy[];
  conditions: Conditions;
  /** Field latitude in degrees, for the height of the sun in the scene. */
  latitude: number;
  cropNames: Record<string, string>;
  selectedMonthRequest?: { month: number; seq: number } | null;
  highlightedStrategyId?: string | null;
  onSelectStrategy?: (id: string) => void;
  onActiveMonthChange?: (monthIndex: number) => void;
}

/** "+20 mm" / "−35 mm": a true minus sign, so it reads as a number and not a hyphen. */
function signedMm(mm: number): string {
  return `${mm > 0 ? "+" : mm < 0 ? "−" : ""}${Math.abs(mm)} mm`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function DeltaBadge({ diff, unit = "", lowerIsBetter = true }: { diff: number; unit?: string; lowerIsBetter?: boolean }) {
  if (diff === 0) return null;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  const sign = diff > 0 ? "+" : "";
  return <span className={good ? "delta good" : "delta warn"}>{`${sign}${diff}${unit} vs current`}</span>;
}

export default function SeasonView({
  strategies,
  conditions,
  latitude,
  cropNames,
  selectedMonthRequest,
  highlightedStrategyId,
  onSelectStrategy,
  onActiveMonthChange,
}: Props) {
  const shown = strategies;
  const years = cycleYears(...shown.map((s) => s.calendar.length));
  const steps = years * 12;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [cameraView, setCameraView] = useState<CameraView>("overview");
  const [fitVersion, setFitVersion] = useState(0);
  const anchors = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => setStep(0), [strategies]);
  useEffect(() => {
    if (!selectedMonthRequest) return;
    setPlaying(false);
    setStep((s) => {
      const clamped = Math.min(s, steps - 1);
      const yearBase = Math.floor(clamped / 12) * 12;
      return (yearBase + selectedMonthRequest.month) % steps;
    });
  }, [selectedMonthRequest, steps]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setStep((s) => (s + 1) % steps), STEP_MS);
    return () => clearInterval(timer);
  }, [playing, steps]);

  const current = Math.min(step, steps - 1);
  const weather = weatherFrame(conditions, current);
  const plots = shown.map((s) => {
    const frame = plotFrame(s, current);
    return { strategy: s, frame, total: tally(s, conditions, current), water: waterBalance(frame, weather) };
  });
  const lang = getLang(); // the moments carry text: recompute when the language changes
  const moments = useMemo(() => keyMoments(shown, conditions, steps), [shown, conditions, steps, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const momentInView = moments.filter((m) => m.step === current);
  const baselineTotal = plots[0].total;
  const highlightedIndex = highlightedStrategyId ? shown.findIndex((s) => s.id === highlightedStrategyId) : -1;

  const roleLabel = (index: number, isBaseline: boolean) =>
    isBaseline ? t("Your rotation") : shown.length > 2 ? t("Option {n}", { n: index }) : t("Option");
  const shortRoleKey = (index: number, isBaseline: boolean) =>
    isBaseline ? t("Yours") : shown.length > 2 ? t("Opt {n}", { n: index }) : t("Opt");

  const shortStageCrop = (frame: ReturnType<typeof plotFrame>) => {
    if (frame.state === "bare" || !frame.crop) return t("Bare");
    if (frame.state === "planted") return t("Sown");
    if (frame.crop === "rye_cover") return t("Rye cover");
    const name = cropNames[frame.crop] ?? frame.crop.replaceAll("_", " ");
    return name.replace(" (grain)", "");
  };

  const jumpTo = (next: number) => {
    const wrapped = ((next % steps) + steps) % steps;
    setPlaying(false);
    setStep(wrapped);
    onActiveMonthChange?.(wrapped % 12);
  };

  return (
    <section className="season" aria-label={t("Season view")}>
      <div className="season-head">
        <div>
          <h2>{t("Watch the seasons")}</h2>
          <p className="hint">
            {t("All {n} compared rotations side by side in your field's average weather ({period}), month by month.", {
              n: shown.length,
              period: conditions.period,
            })}
          </p>
        </div>
        <div className="camera-views" role="group" aria-label={t("3D camera view")}>
          {CAMERA_VIEWS.map(({ mode, label }) => {
            const active = cameraView === mode;
            return (
              <button
                key={mode}
                type="button"
                className={active ? "secondary active" : "secondary"}
                aria-pressed={active}
                title={active ? t("Click to reset zoom and camera angle") : undefined}
                onClick={() => {
                  setCameraView(mode);
                  setFitVersion((v) => v + 1);
                }}
              >
                {t(label)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="season-stage">
        <Canvas
          shadows="soft"
          dpr={[1, 1.5]}
          gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.06 }}
          camera={{ position: [0, 6.8, 11.8], fov: 45 }}
          fallback={<p className="hint">{t("The 3D view needs WebGL, which this browser does not offer.")}</p>}
        >
          <FieldScene
            frames={plots.map((p) => p.frame)}
            weather={weather}
            latitude={latitude}
            anchors={anchors}
            cameraView={cameraView}
            fitVersion={fitVersion}
            highlightedIndex={highlightedIndex >= 0 ? highlightedIndex : undefined}
          />
        </Canvas>
        {plots.map(({ strategy, frame, water }, i) => {
          const isHighlighted = strategy.id === highlightedStrategyId;
          const roots = rootProfile(frame);
          return (
            <div
              key={strategy.id}
              className={isHighlighted ? "stage-tags is-highlighted" : "stage-tags"}
              ref={(el) => {
                anchors.current[i] = el;
              }}
            >
              <span className={strategy.is_baseline ? "scene-tag role baseline" : "scene-tag role"}>
                {shortRoleKey(i, strategy.is_baseline)} · {shortStageCrop(frame)}
              </span>
              {cameraView === "roots" && (
                <span className="scene-tag">
                  {roots.activeDepthM > 0 ? t("Roots {m} m", { m: num(Number(roots.activeDepthM.toFixed(1))) }) : t("No living roots")}
                </span>
              )}
              {erosionRisk(frame, weather) && <span className="scene-tag warn">{t("Bare + heavy rain")}</span>}
            </div>
          );
        })}
      </div>

      {moments.length > 0 && (
        <div className="key-moments" role="group" aria-label={t("Months worth a look")}>
          <span className="key-moments-label">{t("Jump to")}</span>
          {moments.map((m) => {
            const active = m.step === current;
            return (
              <button
                key={m.kind}
                type="button"
                className={active ? "secondary active" : "secondary"}
                aria-pressed={active}
                onClick={() => jumpTo(m.step)}
              >
                {m.label}{" "}
                <span className="key-moment-when">
                  {t("{month}, year {n}", { month: t(SHORT_MONTHS[m.step % 12]), n: Math.floor(m.step / 12) + 1 })}
                </span>
              </button>
            );
          })}
          {momentInView.length > 0 && (
            <p className="key-moment-detail" role="status">
              {momentInView.map((m) => m.detail).join(" · ")}
            </p>
          )}
        </div>
      )}

      <div className="playback-bar" role="group" aria-label={t("Season playback controls")}>
        <div className="step-buttons">
          <button type="button" className="secondary" aria-label={t("Previous month")} onClick={() => jumpTo(current - 1)}>
            ‹
          </button>
          <button type="button" className="secondary active-play" aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>
            {playing ? t("Pause") : t("Play")}
          </button>
          <button type="button" className="secondary" aria-label={t("Next month")} onClick={() => jumpTo(current + 1)}>
            ›
          </button>
        </div>

        <div className="scrubber-wrap">
          <div className="scrubber-ticks" aria-hidden="true">
            {Array.from({ length: steps }, (_, s) => (
              <span
                key={s}
                className={s % 12 === 0 ? "tick year-start" : "tick"}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={steps - 1}
            value={current}
            aria-label={t("Month")}
            onChange={(e) => jumpTo(Number(e.target.value))}
          />
          <div className="scrubber-year-marks" aria-hidden="true">
            {Array.from({ length: years }, (_, yi) => (
              <span key={yi}>{t("Yr {n}", { n: yi + 1 })}</span>
            ))}
          </div>
        </div>

        <div className="season-month-pill" aria-live="polite">
          <strong>{t(MONTH_NAMES[weather.month])}</strong> ·{" "}
          {t("year {n} of {total}", { n: Math.floor(current / 12) + 1, total: years })}
        </div>
      </div>

      <div className="season-live-strip" aria-label={t("Live month status")}>
        <p className="weather-line">
          <strong>{t("Typical weather this month:")}</strong> {t("rain {mm} mm", { mm: Math.round(weather.rainMm) })}
          {weather.frost && t(" · frost likely")}
          {weather.heavyRainDays >= HEAVY_RAIN_MONTH && t(" · heavy rain likely")}
          {weather.heatDays >= 0.5 &&
            (Math.round(weather.heatDays) === 1
              ? t(" · about 1 very hot day")
              : t(" · about {n} very hot days", { n: Math.round(weather.heatDays) }))}
        </p>
        <ul className="month-lines">
          {plots.map(({ strategy, frame }, i) => (
            <li key={strategy.id} className={strategy.id === highlightedStrategyId ? "is-highlighted" : undefined}>
              <span className="kind">{roleLabel(i, strategy.is_baseline)}</span>
              <span>{describe(frame, cropNames)}</span>
              {erosionRisk(frame, weather) && <span className="delta warn">{t("bare soil in a heavy-rain month")}</span>}
            </li>
          ))}
        </ul>
        <details className="month-figures">
          <summary>{t("Figures for this month")}</summary>
          <p className="hint">
            {t("Rain {rain} mm · evaporative demand {et0} mm", { rain: Math.round(weather.rainMm), et0: Math.round(weather.et0Mm) })}
            {weather.heavyRainDays >= HEAVY_RAIN_MONTH &&
              t(" · heavy rain on {n} days", { n: num(Number(weather.heavyRainDays.toFixed(1))) })}
            {weather.heatDays >= 0.5 && t(" · {n} days at 35 °C or more", { n: num(Number(weather.heatDays.toFixed(1))) })}
          </p>
          <div className="live-strip-grid" data-count={plots.length}>
          {plots.map(({ strategy, frame, total, water }, i) => {
            const diff = !strategy.is_baseline ? compareTally(total, baselineTotal) : null;
            const roots = rootProfile(frame);
            const isHighlighted = strategy.id === highlightedStrategyId;
            return (
              <div
                key={strategy.id}
                className={[
                  "live-strip-item",
                  strategy.is_baseline ? "baseline" : "",
                  isHighlighted ? "is-highlighted" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelectStrategy?.(strategy.id)}
              >
                <div className="live-strip-head">
                  <span className="kind">{roleLabel(i, strategy.is_baseline)}</span>
                  <strong className="live-name">{strategy.name}</strong>
                </div>
                <p className="live-stage">
                  {t("Year {n}: {state}", { n: frame.rotationYear, state: describe(frame, cropNames) })}
                </p>
                <dl className="live-metrics">
                  <div className="wide">
                    <dt>{t("Rain − crop water use, this month")}</dt>
                    <dd>
                      {water.rainMm} − {water.useMm} = {signedMm(water.balanceMm)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Roots (FAO-56)")}</dt>
                    <dd>
                      {roots.activeDepthM > 0
                        ? `${num(Number(roots.activeDepthM.toFixed(1)))} m (${t(roots.architecture)}${roots.nitrogenFixing ? t(" · fixes N") : ""})`
                        : t("0 m (no living roots)")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Water so far")}</dt>
                    <dd>
                      {total.waterMm} mm
                      {diff && <DeltaBadge diff={diff.waterDiffMm} unit=" mm" />}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Bare months")}</dt>
                    <dd>
                      {total.bareMonths}
                      {diff && <DeltaBadge diff={diff.bareMonthsDiff} />}
                    </dd>
                  </div>
                  <div className={total.soilAtRisk > 0 ? "risk" : undefined}>
                    <dt>{t("In heavy rain")}</dt>
                    <dd>
                      {total.soilAtRisk}
                      {diff && <DeltaBadge diff={diff.soilAtRiskDiff} />}
                    </dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
        </details>
      </div>

      <div className="season-timeline">
        <div className="timeline-legend">
          <span><i className="swatch state-crop" aria-hidden="true" /> {t("Living crop")}</span>
          <span><i className="swatch state-cover" aria-hidden="true" /> {t("Cover crop")}</span>
          <span><i className="swatch state-planted" aria-hidden="true" /> {t("Newly sown")}</span>
          <span><i className="swatch state-bare" aria-hidden="true" /> {t("Bare soil")}</span>
          <span><i className="rain-dot" aria-hidden="true" /> {t("Heavy-rain month (≥ 20 mm/day)")}</span>
          <span className="timeline-row-guide">
            <strong>{t("Rows:")}</strong> {t("Top = Your rotation")}
            {shown.length > 1 ? t(" · Options below") : ""}
          </span>
        </div>
        <div className="timeline-years">
          {Array.from({ length: years }, (_, yearIdx) => {
            const isActiveYear = Math.floor(current / 12) === yearIdx;
            return (
              <div key={yearIdx} className={isActiveYear ? "timeline-year active-year" : "timeline-year"}>
                <div className="timeline-year-head">
                  <span className="timeline-year-label">{t("Year {n}", { n: yearIdx + 1 })}</span>
                  {isActiveYear && <span className="timeline-year-now">{t("Viewing now")}</span>}
                  <span className="timeline-year-crops visually-hidden">
                    {shown
                      .map((s, i) => `${shortRoleKey(i, s.is_baseline)}: ${yearCropLabel(s, yearIdx, cropNames)}`)
                      .join(" · ")}
                  </span>
                </div>
                <div className="timeline-months">
                  <div className="timeline-row-keys" aria-hidden="true">
                    <span className="timeline-row-key timeline-row-key-mo">{t("Mo")}</span>
                    {shown.map((s, i) => {
                      const label = yearCropLabel(s, yearIdx, cropNames);
                      const isRowHighlighted = s.id === highlightedStrategyId;
                      return (
                        <span
                          key={s.id}
                          className={[
                            "timeline-row-key",
                            s.is_baseline ? "baseline" : "",
                            isRowHighlighted ? "is-highlighted" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          title={label}
                        >
                          <strong>{shortRoleKey(i, s.is_baseline)}</strong>
                          <span className="row-crop">{label}</span>
                        </span>
                      );
                    })}
                  </div>
                  {SHORT_MONTHS.map((mLabel, monthIdx) => {
                    const s = yearIdx * 12 + monthIdx;
                    const cellFrames = shown.map((st) => plotFrame(st, s));
                    const heavy = conditions.monthly_heavy_rain_days[monthIdx] >= HEAVY_RAIN_MONTH;
                    const active = s === current;
                    const tooltip = [
                      t("Year {n}, {month}", { n: yearIdx + 1, month: t(MONTH_NAMES[monthIdx]) }) +
                        (heavy ? t(" (heavy-rain month)") : ""),
                      ...shown.map(
                        (st, idx) => `${shortRoleKey(idx, st.is_baseline)}: ${describe(cellFrames[idx], cropNames)}`,
                      ),
                    ].join(" — ");
                    return (
                      <button
                        key={s}
                        type="button"
                        className={active ? "timeline-cell active" : "timeline-cell"}
                        aria-label={t("Year {n}, {month}", { n: yearIdx + 1, month: t(MONTH_NAMES[monthIdx]) })}
                        aria-current={active ? "step" : undefined}
                        title={tooltip}
                        onClick={() => jumpTo(s)}
                      >
                        <span className="timeline-month-letter">
                          {mLabel[0]}
                          {heavy && <span className="rain-dot" title={t("Heavy-rain month")} />}
                        </span>
                        {shown.map((st, idx) => (
                          <span
                            key={st.id}
                            className={`timeline-bar state-${cellFrames[idx].state}`}
                            title={`${roleLabel(idx, st.is_baseline)}: ${t(cellFrames[idx].state)}`}
                          />
                        ))}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="hint">
        {t(
          "A typical year from {period} weather, not a forecast. Crop stages follow typical calendars, not satellite observations of this field.",
          { period: conditions.period },
        )}
        {cameraView === "roots" &&
          t(
            " In this view the soil is drawn {x}× deeper than true scale so roots can be read. The lines mark 0.5, 1.0 and 1.5 m.",
            { x: ROOTS_SOIL_EXAGGERATION },
          )}
      </p>
      <details className="about-picture">
        <summary>{t("About this picture")}</summary>
        <p className="hint">
          {t(
            "Weather is the {period} monthly average from NASA POWER. Newly sown months count as bare: there is little cover yet. Darker soil means the month's rain exceeds the crop's water use. It is not measured soil moisture. The striped pole is 2 m tall and crops are drawn at typical mature heights. The sun stands at its midday height for this latitude and month. The trees are scenery, not this field's surroundings.",
            { period: conditions.period },
          )}
        </p>
      </details>
    </section>
  );
}
