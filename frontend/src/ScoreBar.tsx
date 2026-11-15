import { t } from "./i18n";

interface Props {
  label: string;
  /** Score normalized 0..1. */
  score: number;
  /** Optional current-rotation score normalized 0..1 shown as a reference pin on the same track. */
  baselineScore?: number;
  showDelta?: boolean;
}

/** Accessible score bar with optional baseline marker pin and tabular score readout. */
export default function ScoreBar({ label, score, baselineScore, showDelta = false }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  const basePct = baselineScore !== undefined ? Math.max(0, Math.min(100, Math.round(baselineScore * 100))) : null;
  const diff = basePct !== null ? pct - basePct : null;
  const valueText =
    basePct !== null
      ? t("{pct} out of 100 (current rotation: {base})", { pct, base: basePct })
      : t("{pct} out of 100", { pct });

  return (
    <div className="score-bar-row">
      <div
        className="score-track"
        role="meter"
        aria-label={t("{label} score", { label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={valueText}
      >
        <div className="score-fill" style={{ width: `${pct}%` }} />
        {basePct !== null && (
          <span
            className="score-baseline-pin"
            style={{ left: `${basePct}%` }}
            title={t("Your current rotation: {base} / 100", { base: basePct ?? "" })}
            aria-hidden="true"
          />
        )}
      </div>
      <span className="score-num">
        {pct}
        {showDelta && diff !== null && diff !== 0 && (
          <span className={diff > 0 ? "score-delta pos" : "score-delta neg"}>
            {" "}
            ({diff > 0 ? `+${diff}` : diff})
          </span>
        )}
      </span>
    </div>
  );
}
