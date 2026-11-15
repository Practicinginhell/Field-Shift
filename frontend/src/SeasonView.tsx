// "Watch the seasons": the current rotation and one option, side by side in 3D, played
// month by month. Loaded lazily, so the 3D library only downloads when results show.

import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { ACESFilmicToneMapping } from "three";

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

const CAMERA_VIEWS: { mode: CameraView; label: string }[] = [
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
  const moments = useMemo(() => keyMoments(shown, conditions, steps), [shown, conditions, steps]);
  const momentInView = moments.filter((m) => m.step === current);
  const baselineTotal = plots[0].total;
  const highlightedIndex = highlightedStrategyId ? shown.findIndex((s) => s.id === highlightedStrategyId) : -1;

  const roleLabel = (index: number, isBaseline: boolean) =>
    isBaseline ? "Your rotation" : shown.length > 2 ? `Option ${index}` : "Option";
  const shortRoleKey = (index: number, isBaseline: boolean) =>
    isBaseline ? "Yours" : shown.length > 2 ? `Opt ${index}` : "Opt";

  const shortStageCrop = (frame: ReturnType<typeof plotFrame>) => {
    if (frame.state === "bare" || !frame.crop) return "Bare";
    if (frame.state === "planted") return "Sown";
    if (frame.crop === "rye_cover") return "Rye cover";
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
    <section className="season" aria-label="Season view">
      <div className="season-head">
        <div>
          <h2>Watch the seasons</h2>
          <p className="hint">
            All {shown.length} compared rotations side by side in your field's average weather ({conditions.period}),
            month by month.
          </p>
        </div>
        <div className="camera-views" role="group" aria-label="3D camera view">
          {CAMERA_VIEWS.map(({ mode, label }) => {
            const active = cameraView === mode;
            return (
              <button
                key={mode}
                type="button"
                className={active ? "secondary active" : "secondary"}
                aria-pressed={active}
                title={active ? "Click to reset zoom and camera angle" : undefined}
                onClick={() => {
                  setCameraView(mode);
                  setFitVersion((v) => v + 1);
                }}
              >
                {label}
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
          fallback={<p className="hint">The 3D view needs WebGL, which this browser does not offer.</p>}
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
                  {roots.activeDepthM > 0 ? `Roots ${roots.activeDepthM.toFixed(1)} m` : "No living roots"}
                </span>
              )}
              {erosionRisk(frame, weather) && <span className="scene-tag warn">Bare + heavy rain</span>}
            </div>
          );
        })}
      </div>

      {moments.length > 0 && (
        <div className="key-moments" role="group" aria-label="Months worth a look">
          <span className="key-moments-label">Jump to</span>
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
                  {SHORT_MONTHS[m.step % 12]}, year {Math.floor(m.step / 12) + 1}
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

      <div className="playback-bar" role="group" aria-label="Season playback controls">
        <div className="step-buttons">
          <button type="button" className="secondary" aria-label="Previous month" onClick={() => jumpTo(current - 1)}>
            ‹
          </button>
          <button type="button" className="secondary active-play" aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="secondary" aria-label="Next month" onClick={() => jumpTo(current + 1)}>
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
            aria-label="Month"
            onChange={(e) => jumpTo(Number(e.target.value))}
          />
          <div className="scrubber-year-marks" aria-hidden="true">
            {Array.from({ length: years }, (_, yi) => (
              <span key={yi}>Yr {yi + 1}</span>
            ))}
          </div>
        </div>

        <div className="season-month-pill" aria-live="polite">
          <strong>{MONTH_NAMES[weather.month]}</strong> · year {Math.floor(current / 12) + 1} of {years}
        </div>
      </div>

      <div className="season-live-strip" aria-label="Live month status">
        <p className="weather-line">
          <strong>Typical weather this month:</strong> rain {Math.round(weather.rainMm)} mm
          {weather.frost && " · frost likely"}
          {weather.heavyRainDays >= HEAVY_RAIN_MONTH && " · heavy rain likely"}
          {weather.heatDays >= 0.5 && ` · about ${Math.round(weather.heatDays)} very hot ${Math.round(weather.heatDays) === 1 ? "day" : "days"}`}
        </p>
        <ul className="month-lines">
          {plots.map(({ strategy, frame }, i) => (
            <li key={strategy.id} className={strategy.id === highlightedStrategyId ? "is-highlighted" : undefined}>
              <span className="kind">{roleLabel(i, strategy.is_baseline)}</span>
              <span>{describe(frame, cropNames)}</span>
              {erosionRisk(frame, weather) && <span className="delta warn">bare soil in a heavy-rain month</span>}
            </li>
          ))}
        </ul>
        <details className="month-figures">
          <summary>Figures for this month</summary>
          <p className="hint">
            Rain {Math.round(weather.rainMm)} mm · evaporative demand {Math.round(weather.et0Mm)} mm
            {weather.heavyRainDays >= HEAVY_RAIN_MONTH && ` · heavy rain on ${weather.heavyRainDays.toFixed(1)} days`}
            {weather.heatDays >= 0.5 && ` · ${weather.heatDays.toFixed(1)} days at 35 °C or more`}
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
                  Year {frame.rotationYear}: {describe(frame, cropNames)}
                </p>
                <dl className="live-metrics">
                  <div className="wide">
                    <dt>Rain − crop water use, this month</dt>
                    <dd>
                      {water.rainMm} − {water.useMm} = {signedMm(water.balanceMm)}
                    </dd>
                  </div>
                  <div>
                    <dt>Roots (FAO-56)</dt>
                    <dd>
                      {roots.activeDepthM > 0
                        ? `${roots.activeDepthM.toFixed(1)} m (${roots.architecture}${roots.nitrogenFixing ? " · fixes N" : ""})`
                        : "0 m (no living roots)"}
                    </dd>
                  </div>
                  <div>
                    <dt>Water so far</dt>
                    <dd>
                      {total.waterMm} mm
                      {diff && <DeltaBadge diff={diff.waterDiffMm} unit=" mm" />}
                    </dd>
                  </div>
                  <div>
                    <dt>Bare months</dt>
                    <dd>
                      {total.bareMonths}
                      {diff && <DeltaBadge diff={diff.bareMonthsDiff} />}
                    </dd>
                  </div>
                  <div className={total.soilAtRisk > 0 ? "risk" : undefined}>
                    <dt>In heavy rain</dt>
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
          <span><i className="swatch state-crop" aria-hidden="true" /> Living crop</span>
          <span><i className="swatch state-cover" aria-hidden="true" /> Cover crop</span>
          <span><i className="swatch state-planted" aria-hidden="true" /> Newly sown</span>
          <span><i className="swatch state-bare" aria-hidden="true" /> Bare soil</span>
          <span><i className="rain-dot" aria-hidden="true" /> Heavy-rain month (≥ 20 mm/day)</span>
          <span className="timeline-row-guide">
            <strong>Rows:</strong> Top = Your rotation{shown.length > 1 ? " · Options below" : ""}
          </span>
        </div>
        <div className="timeline-years">
          {Array.from({ length: years }, (_, yearIdx) => {
            const isActiveYear = Math.floor(current / 12) === yearIdx;
            return (
              <div key={yearIdx} className={isActiveYear ? "timeline-year active-year" : "timeline-year"}>
                <div className="timeline-year-head">
                  <span className="timeline-year-label">Year {yearIdx + 1}</span>
                  {isActiveYear && <span className="timeline-year-now">Viewing now</span>}
                  <span className="timeline-year-crops visually-hidden">
                    {shown
                      .map((s, i) => `${shortRoleKey(i, s.is_baseline)}: ${yearCropLabel(s, yearIdx, cropNames)}`)
                      .join(" · ")}
                  </span>
                </div>
                <div className="timeline-months">
                  <div className="timeline-row-keys" aria-hidden="true">
                    <span className="timeline-row-key timeline-row-key-mo">Mo</span>
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
                      `Year ${yearIdx + 1}, ${MONTH_NAMES[monthIdx]}${heavy ? " (heavy-rain month)" : ""}`,
                      ...shown.map(
                        (st, idx) => `${shortRoleKey(idx, st.is_baseline)}: ${describe(cellFrames[idx], cropNames)}`,
                      ),
                    ].join(" — ");
                    return (
                      <button
                        key={s}
                        type="button"
                        className={active ? "timeline-cell active" : "timeline-cell"}
                        aria-label={`Year ${yearIdx + 1}, ${MONTH_NAMES[monthIdx]}`}
                        aria-current={active ? "step" : undefined}
                        title={tooltip}
                        onClick={() => jumpTo(s)}
                      >
                        <span className="timeline-month-letter">
                          {mLabel[0]}
                          {heavy && <span className="rain-dot" title="Heavy-rain month" />}
                        </span>
                        {shown.map((st, idx) => (
                          <span
                            key={st.id}
                            className={`timeline-bar state-${cellFrames[idx].state}`}
                            title={`${roleLabel(idx, st.is_baseline)}: ${cellFrames[idx].state}`}
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
        A typical year from {conditions.period} weather, not a forecast. Crop stages follow typical calendars, not
        satellite observations of this field.
        {cameraView === "roots" &&
          ` In this view the soil is drawn ${ROOTS_SOIL_EXAGGERATION}× deeper than true scale so roots can be read. The lines mark 0.5, 1.0 and 1.5 m.`}
      </p>
      <details className="about-picture">
        <summary>About this picture</summary>
        <p className="hint">
          Weather is the {conditions.period} monthly average from NASA POWER. Newly sown months count as bare: there is
          little cover yet. Darker soil means the month's rain exceeds the crop's water use. It is not measured soil
          moisture. The striped pole is 2 m tall and crops are drawn at typical mature heights. The sun stands at its
          midday height for this latitude and month. The trees are scenery, not this field's surroundings.
        </p>
      </details>
    </section>
  );
}
