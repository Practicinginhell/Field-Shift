import { CRITERION_NAMES } from "./PrioritySliders";
import type { Criterion, Priorities, Strategy } from "./types";

const BASE_CRITERIA = Object.keys(CRITERION_NAMES) as Criterion[];

/** Returns criteria ordered descending by the farmer's weight (preserving key order on ties). */
export function orderedCriteriaByWeight(weights: Priorities): Criterion[] {
  return [...BASE_CRITERIA].sort((a, b) => weights[b] - weights[a]);
}

interface Props {
  strategies: Strategy[];
  weights: Priorities;
  selectedIds: string[];
  highlightedId: string | null;
  onSelectStrategy: (id: string) => void;
  onToggleSecond?: (id: string) => void;
  irrigated?: boolean;
}

function formatDelta(diff: number): string {
  if (diff === 0) return "0";
  return diff > 0 ? `+${diff}` : `${diff}`;
}

export default function ComparisonMatrix({
  strategies,
  weights,
  selectedIds,
  highlightedId,
  onSelectStrategy,
  onToggleSecond,
  irrigated,
}: Props) {
  const orderedStrategies = [...strategies].sort((a, b) => Number(b.is_baseline) - Number(a.is_baseline));
  const baseline = orderedStrategies.find((s) => s.is_baseline) ?? orderedStrategies[0];
  const criteria = orderedCriteriaByWeight(weights);

  const pct = (v: number) => Math.round(v * 100);
  const fitValues = orderedStrategies.map((s) => pct(s.total));
  const fitMin = Math.min(...fitValues);
  const fitMax = Math.max(...fitValues);
  const hasFitSpread = fitMax > fitMin;

  const criterionRange = new Map<Criterion, { min: number; max: number }>();
  for (const c of criteria) {
    const vals = orderedStrategies.map((s) => pct(s.scores[c]));
    criterionRange.set(c, { min: Math.min(...vals), max: Math.max(...vals) });
  }

  let optCounter = 0;

  return (
    <div className="matrix-shell">
      <div className="matrix-head-note">
        <p className="hint">
          Select any row to inspect its reasons, evidence, gaps, and local checks below — and highlight it in 3D. Columns
          follow your priority weights (0 = de-emphasised).
        </p>
      </div>
      <div className="matrix-wrap">
        <table className="comparison-matrix" aria-label="Rotations compared at a glance">
          <thead>
            <tr>
              <th scope="col" className="col-strategy">
                Rotation
              </th>
              <th scope="col" className="col-fit">
                Fit score
                <small>0–100</small>
              </th>
              {criteria.map((c) => {
                const w = weights[c];
                return (
                  <th key={c} scope="col" className={w === 0 ? "is-zero-weight" : undefined} title={CRITERION_NAMES[c]}>
                    <span>{CRITERION_NAMES[c]}</span>
                    <small>{w === 0 ? "Priority 0" : `Priority ${w}/5`}</small>
                  </th>
                );
              })}
              <th scope="col" className="col-actions">
                Details
              </th>
            </tr>
          </thead>
          <tbody>
            {orderedStrategies.map((s) => {
              const isBase = s.is_baseline;
              if (!isBase) optCounter += 1;
              const tag = isBase ? "Yours" : `Opt ${optCounter}`;
              const isSelected = selectedIds.includes(s.id);
              const isPrimary = selectedIds[0] === s.id;
              const isHighlighted = highlightedId === s.id;
              const fit = pct(s.total);
              const fitDiff = fit - pct(baseline.total);
              const fitBest = hasFitSpread && fit === fitMax;

              const rowClasses = [
                isBase ? "is-baseline" : "is-option",
                isSelected ? "is-selected" : "",
                isHighlighted ? "is-highlighted" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <tr
                  key={s.id}
                  className={rowClasses}
                  onClick={() => onSelectStrategy(s.id)}
                >
                  <th scope="row" className="cell-strategy">
                    <div className="matrix-role-row">
                      <span className="matrix-tag">{tag}</span>
                      <span className="kind">{isBase ? "Your current rotation" : "Option to explore"}</span>
                    </div>
                    <strong className="matrix-name">{s.name}</strong>
                    <div className="matrix-meta">
                      {s.water_demand_mm} mm/yr · {s.cover_months} mo cover
                      {s.rainfed_shortfall_mm > 0
                        ? irrigated
                          ? ` · ${s.rainfed_shortfall_mm} mm irrigation`
                          : ` · −${s.rainfed_shortfall_mm} mm shortfall`
                        : ""}
                    </div>
                  </th>
                  <td
                    className={fitBest ? "cell-fit is-best" : "cell-fit"}
                    data-label="Fit score (0–100)"
                    title={fitBest ? "Highest fit score among shown rotations" : undefined}
                  >
                    <span className="cell-score">{fit}</span>
                    {!isBase && (
                      <span className={`cell-delta ${fitDiff > 0 ? "pos" : fitDiff < 0 ? "neg" : "neutral"}`}>
                        {formatDelta(fitDiff)}
                      </span>
                    )}
                    {fitBest && <span className="best-dot" aria-label="Highest in column" />}
                  </td>
                  {criteria.map((c) => {
                    const val = pct(s.scores[c]);
                    const diff = val - pct(baseline.scores[c]);
                    const range = criterionRange.get(c)!;
                    const best = range.max > range.min && val === range.max;
                    const zero = weights[c] === 0;
                    const cellClass = [zero ? "is-zero-weight" : "", best ? "is-best" : ""].filter(Boolean).join(" ");
                    return (
                      <td
                        key={c}
                        className={cellClass || undefined}
                        data-label={`${CRITERION_NAMES[c]} (wt ${weights[c]})`}
                        title={best ? `Highest score for ${CRITERION_NAMES[c]}` : undefined}
                      >
                        <span className="cell-score">{val}</span>
                        {!isBase && (
                          <span className={`cell-delta ${diff > 0 ? "pos" : diff < 0 ? "neg" : "neutral"}`}>
                            {formatDelta(diff)}
                          </span>
                        )}
                        {best && <span className="best-dot" aria-label="Highest in column" />}
                      </td>
                    );
                  })}
                  <td className="cell-actions" data-label="Details" onClick={(e) => e.stopPropagation()}>
                    <div className="matrix-action-group">
                      <button
                        type="button"
                        className={isPrimary ? "secondary active" : "secondary"}
                        aria-pressed={isPrimary}
                        aria-label={`Inspect ${s.name}`}
                        onClick={() => onSelectStrategy(s.id)}
                      >
                        {isPrimary ? "Inspecting" : "Inspect"}
                      </button>
                      {onToggleSecond && !isPrimary && orderedStrategies.length > 1 && (
                        <button
                          type="button"
                          className={isSelected ? "link active" : "link"}
                          aria-pressed={isSelected}
                          aria-label={isSelected ? `Hide second detail ${s.name}` : `Compare details with ${s.name}`}
                          onClick={() => onToggleSecond(s.id)}
                        >
                          {isSelected ? "Pinned 2nd" : "+ Compare 2nd"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
