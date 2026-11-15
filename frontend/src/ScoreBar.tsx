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
  const valueText = basePct !== null ? `${pct} out of 100 (current rotation: ${basePct})` : `${pct} out of 100`;

  return (
    <div className="score-bar-row">
      <div
        className="score-track"
        role="meter"
        aria-label={`${label} score`}
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
            title={`Your current rotation: ${basePct} / 100`}
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
