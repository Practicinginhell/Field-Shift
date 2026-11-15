// "Your field, seen from space": replays what NASA satellites saw on the field, month by
// month, 2019–2024, in the same 3D scene as the season view. Prepared for the example
// fields only (see backend/tools). Loaded lazily with the rest of the 3D code.

import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { ACESFilmicToneMapping } from "three";
import { num, t } from "./i18n";

import FieldScene from "./FieldScene";
import {
  dayOfYearText,
  flagText,
  modelText,
  observedFrames,
  observedSummary,
  plainStateText,
  stateText,
} from "./observed";
import { HEAVY_RAIN_MONTH, MONTH_NAMES, SHORT_MONTHS, weatherFrame } from "./season";
import type { Conditions, ObservedField } from "./types";

const STEP_MS = 900;

interface Props {
  field: ObservedField;
  conditions: Conditions;
  /** Field latitude in degrees, for the height of the sun in the scene. */
  latitude: number;
  cropNames: Record<string, string>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return t("{month} {day}", { month: t(SHORT_MONTHS[d.getMonth()]), day: d.getDate() });
}

export default function SatelliteReplay({ field, conditions, latitude, cropNames }: Props) {
  const frames = observedFrames(field);
  const steps = frames.length;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Index values, model readings and flagged months show only while "How this was worked out" is open.
  const [showWorking, setShowWorking] = useState(false);
  const anchors = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setStep((s) => (s + 1) % steps), STEP_MS);
    return () => clearInterval(timer);
  }, [playing, steps]);

  const current = Math.min(step, steps - 1);
  const year = field.years[Math.floor(current / 12)];
  const month = year.months[current % 12];
  const average = weatherFrame(conditions, current);
  const weather = { ...average, frost: average.frost || month.state === "snow" };
  const heavy = conditions.monthly_heavy_rain_days.map((d) => d >= HEAVY_RAIN_MONTH);
  const summary = observedSummary(field, heavy);
  const flag = flagText(month);
  const reading = modelText(year);
  const model = field.crop_model;
  const first = field.years[0].year;
  const last = field.years[field.years.length - 1].year;

  const jumpTo = (next: number) => {
    setPlaying(false);
    setStep(((next % steps) + steps) % steps);
  };

  return (
    <section className="season replay" aria-label={t("Your field seen from space")}>
      <div className="season-head">
        <div>
          <h2>
            {t("Your field, seen from space ({first}–{last})", { first, last })}
          </h2>
          <p className="hint">
            {t("What NASA satellites actually saw on this field each month, not a typical calendar.")}
          </p>
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
          <FieldScene frames={[frames[current]]} weather={weather} latitude={latitude} anchors={anchors} />
        </Canvas>
        <div
          className="stage-tags"
          ref={(el) => {
            anchors.current[0] = el;
          }}
        >
          <span className="scene-tag role baseline">
            {t("Observed")} · {showWorking ? stateText(month) : plainStateText(month)}
          </span>
          {showWorking && flag && <span className="scene-tag warn">{flag}</span>}
        </div>
      </div>
      <div className="replay-status-bar" aria-live="polite">
        <div className="replay-status-main">
          <strong>
            {t(MONTH_NAMES[current % 12])} {year.year}
          </strong>{" "}
          · {year.crop ? (cropNames[year.crop] ?? year.crop_label) : (year.crop_label ?? t("crop not mapped"))}
        </div>
        {showWorking && reading && <small className={year.model_agrees === false ? "model-reading disagree" : "model-reading"}>{reading}</small>}
      </div>

      <div className="season-controls">
        <div className="step-buttons">
          <button type="button" className="secondary" aria-label={t("Previous month")} onClick={() => jumpTo(current - 1)}>
            ‹
          </button>
          <button type="button" className="secondary" onClick={() => setPlaying((p) => !p)}>
            {playing ? t("Pause") : t("Play")}
          </button>
          <button type="button" className="secondary" aria-label={t("Next month")} onClick={() => jumpTo(current + 1)}>
            ›
          </button>
        </div>
        <input
          type="range"
          min={0}
          max={steps - 1}
          value={current}
          aria-label={t("Observed month")}
          onChange={(e) => jumpTo(Number(e.target.value))}
        />
      </div>

      <div className="replay-grid" role="group" aria-label={t("Observed months")}>
        <div className="replay-legend">
          <span><i className="obs obs-green" aria-hidden="true" /> {t("Green")}</span>
          <span><i className="obs obs-partial" aria-hidden="true" /> {t("Partly green")}</span>
          <span><i className="obs obs-bare" aria-hidden="true" /> {t("Bare or just sown")}</span>
          <span><i className="obs obs-snow" aria-hidden="true" /> {t("Likely snow")}</span>
          <span><i className="obs obs-no_view" aria-hidden="true" /> {t("No clear view")}</span>
          {showWorking && (
            <span><b className="obs-flag" aria-hidden="true">!</b> {t("Unusual month (see below)")}</span>
          )}
        </div>
        <div className="replay-header" role="row" aria-label={t("Months")}>
          <span className="replay-year-corner" role="columnheader" aria-label={t("Year and crop")} />
          {SHORT_MONTHS.map((m, mi) => (
            <span key={m} className="replay-col-head" role="columnheader" aria-label={t(MONTH_NAMES[mi])}>
              {m[0]}
            </span>
          ))}
        </div>
        {field.years.map((y, yi) => (
          <div key={y.year} className="replay-row">
            <span className="replay-year">
              {y.year}
              <small>
                {y.crop ? (cropNames[y.crop] ?? y.crop_label) : (y.crop_label ?? "—")}
                {showWorking && y.model_agrees === false && (
                  <b className="model-disagree" title={modelText(y) ?? undefined}>
                    {" "}?
                  </b>
                )}
              </small>
            </span>
            {y.months.map((m, mi) => {
              const s = yi * 12 + mi;
              return (
                <button
                  key={s}
                  type="button"
                  className={`obs obs-${m.state}${s === current ? " active" : ""}`}
                  aria-label={`${t(MONTH_NAMES[mi])} ${y.year}: ${plainStateText(m)}`}
                  title={
                    showWorking
                      ? `${t(SHORT_MONTHS[mi])} ${y.year}: ${stateText(m)}${m.flags.length ? ` — ${flagText(m)}` : ""}`
                      : `${t(SHORT_MONTHS[mi])} ${y.year}: ${plainStateText(m)}`
                  }
                  onClick={() => jumpTo(s)}
                >
                  {showWorking && m.flags.length > 0 && <b className="obs-flag">!</b>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="scoreboards">
        <div className="scoreboard baseline">
          <p className="kind">{t("{year} season", { year: year.year })}</p>
          <dl>
            <div>
              <dt>{t("Greened up")}</dt>
              <dd>{formatDate(year.greenup)}</dd>
            </div>
            <div>
              <dt>{t("Greenest")}</dt>
              <dd>{formatDate(year.peak)}</dd>
            </div>
            <div>
              <dt>{t("Died back or harvested")}</dt>
              <dd>{formatDate(year.dormancy)}</dd>
            </div>
          </dl>
        </div>
        <div className="scoreboard">
          <p className="kind">
            {t("{first}–{last}, observed", { first, last })}
          </p>
          <dl>
            <div>
              <dt>{t("Months the soil was bare")}</dt>
              <dd>{summary.bare}</dd>
            </div>
            <div className={summary.bareInHeavyRain > 0 ? "risk" : undefined}>
              <dt>{t("…of which in a heavy-rain month")}</dt>
              <dd>{summary.bareInHeavyRain}</dd>
            </div>
            <div>
              <dt>{t("Months likely under snow")}</dt>
              <dd>{summary.snow}</dd>
            </div>
          </dl>
        </div>
      </div>

      <details className="worked-out" onToggle={(e) => setShowWorking(e.currentTarget.open)}>
        <summary>{t("How this was worked out — satellite rules, model checks, and limits")}</summary>
        <div className="worked-out-body">
          <p className="hint">
            {t(
              "Greenness comes from Landsat and Sentinel-2 (30 m), season dates from MODIS, crops from the crop map. While this is open, the picture and the grid above also show the greenness index, the months that looked unusual ({n} flagged) and the crop a model reads from the season's curve. Surface soil moisture this month (SMAP, 9 km area): {sm}.",
              {
                n: summary.flagged,
                sm: month.soil_moisture === null ? t("no value") : `${num(Number(month.soil_moisture.toFixed(2)))} m³/m³`,
              },
            )}
          </p>
          {field.methods.length > 0 && (
            <div className="methods">
              <h3>{t("How we spot unusual months: SI and statistics, compared")}</h3>
              <p className="hint">
                {t(
                  "Two methods predict each month of 2019–2024 from the years before only, with a 10–90% range. A month is flagged only when both methods put it outside their range. TimesFM 2.5 is a pretrained time-series foundation model (SI). The field average uses the same month in earlier years. Lower error is better, and about 80% of months should fall inside the range.",
                )}
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t("Method and data")}</th>
                      <th scope="col">{t("Average error")}</th>
                      <th scope="col">{t("Inside the 10–90% range")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {field.methods.map((m) => (
                      <tr key={m.name}>
                        <th scope="row">{m.name}</th>
                        <td>{num(Number(m.mean_abs_error.toFixed(3)))}</td>
                        <td>{Math.round(m.band_coverage * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hint">{field.methods[0].note}.</p>
            </div>
          )}

          {model && (
            <div className="methods">
              <h3>{t("Which crop grew here? A model trained on the satellite curves")}</h3>
              <p className="hint">
                {t(
                  "Trained on {n} field-interior pixels of eastern Ontario, labelled by Agriculture and Agri-Food Canada's crop map. It reads the crop from the season's greenness alone. {note} The app uses {chosen}. The weeks that tell the crops apart most: {days}.",
                  {
                    n: num(model.n_train),
                    note: model.test_note,
                    chosen: model.chosen,
                    days: model.telling_days.slice(0, 3).map(dayOfYearText).join(", "),
                  },
                )}
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t("Approach")}</th>
                      <th scope="col">{t("Correct (test)")}</th>
                      <th scope="col">{t("Balanced score (macro F1)")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.methods.map((m) => (
                      <tr key={m.name}>
                        <th scope="row">
                          {m.name}
                          {m.name === model.chosen ? t(" (used)") : ""}
                        </th>
                        <td>{Math.round(m.accuracy * 100)}%</td>
                        <td>{num(Number(m.macro_f1.toFixed(2)))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hint">
                {t(
                  'A "?" next to a year means the curve and the crop map disagree. Either can be wrong: the map is itself a model\'s output. You know what you planted.',
                )}
              </p>
            </div>
          )}

          <p className="hint">
            {t(
              "Clear views: {pct}% of satellite passes (the rest were cloudy). Unseen months repeat the month before. Green, bare and snow use common NDVI rules of thumb, not calibrated for this field. Soil moisture is for a 9 km area, not the field itself. A flagged month is a question, not a verdict: check it against what you know happened (late planting, hail, drought, snow, a crop change). Weather shown is the {period} monthly average.",
              { pct: Math.round(field.clear_view_share * 100), period: conditions.period },
            )}
          </p>
        </div>
      </details>
    </section>
  );
}
