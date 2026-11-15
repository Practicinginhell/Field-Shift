import { CRITERION_NAMES } from "./PrioritySliders";
import type { Criterion, Priorities, Strategy } from "./types";
import { num, t } from "./i18n";

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
          {t(
            "Select any row to inspect its reasons, evidence, gaps, and local checks below — and highlight it in 3D. Columns follow your priority weights (0 = de-emphasised).",
          )}
        </p>
      </div>
      <div className="matrix-wrap">
        <table className="comparison-matrix" aria-label={t("Rotations compared at a glance")}>
          <thead>
            <tr>
              <th scope="col" className="col-strategy">
                {t("Rotation")}
              </th>
              <th scope="col" className="col-fit">
                {t("Fit score")}
                <small>0–100</small>
              </th>
              {criteria.map((c) => {
                const w = weights[c];
                return (
                  <th key={c} scope="col" className={w === 0 ? "is-zero-weight" : undefined} title={t(CRITERION_NAMES[c])}>
                    <span>{t(CRITERION_NAMES[c])}</span>
                    <small>{w === 0 ? t("Priority 0") : t("Priority {w}/5", { w })}</small>
                  </th>
                );
              })}
              <th scope="col" className="col-actions">
                {t("Details")}
              </th>
            </tr>
          </thead>
          <tbody>
            {orderedStrategies.map((s) => {
              const isBase = s.is_baseline;
              if (!isBase) optCounter += 1;
              const tag = isBase ? t("Yours") : t("Opt {n}", { n: optCounter });
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
                      <span className="kind">{isBase ? t("Your current rotation") : t("Option to explore")}</span>
                    </div>
                    <strong className="matrix-name">{s.name}</strong>
                    <div className="matrix-meta">
                      {t("{mm} mm/yr · {months} mo cover", { mm: s.water_demand_mm, months: num(s.cover_months) })}
                      {s.rainfed_shortfall_mm > 0
                        ? irrigated
                          ? t(" · {mm} mm irrigation", { mm: s.rainfed_shortfall_mm })
                          : t(" · −{mm} mm shortfall", { mm: s.rainfed_shortfall_mm })
                        : ""}
                    </div>
                  </th>
                  <td
                    className={fitBest ? "cell-fit is-best" : "cell-fit"}
                    data-label={t("Fit score (0–100)")}
                    title={fitBest ? t("Highest fit score among shown rotations") : undefined}
                  >
                    <span className="cell-score">{fit}</span>
                    {!isBase && (
                      <span className={`cell-delta ${fitDiff > 0 ? "pos" : fitDiff < 0 ? "neg" : "neutral"}`}>
                        {formatDelta(fitDiff)}
                      </span>
                    )}
                    {fitBest && <span className="best-dot" aria-label={t("Highest in column")} />}
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
                        data-label={t("{name} (wt {w})", { name: t(CRITERION_NAMES[c]), w: weights[c] })}
                        title={best ? t("Highest score for {name}", { name: t(CRITERION_NAMES[c]) }) : undefined}
                      >
                        <span className="cell-score">{val}</span>
                        {!isBase && (
                          <span className={`cell-delta ${diff > 0 ? "pos" : diff < 0 ? "neg" : "neutral"}`}>
                            {formatDelta(diff)}
                          </span>
                        )}
                        {best && <span className="best-dot" aria-label={t("Highest in column")} />}
                      </td>
                    );
                  })}
                  <td className="cell-actions" data-label={t("Details")} onClick={(e) => e.stopPropagation()}>
                    <div className="matrix-action-group">
                      <button
                        type="button"
                        className={isPrimary ? "secondary active" : "secondary"}
                        aria-pressed={isPrimary}
                        aria-label={t("Inspect {name}", { name: s.name })}
                        onClick={() => onSelectStrategy(s.id)}
                      >
                        {isPrimary ? t("Inspecting") : t("Inspect")}
                      </button>
                      {onToggleSecond && !isPrimary && orderedStrategies.length > 1 && (
                        <button
                          type="button"
                          className={isSelected ? "link active" : "link"}
                          aria-pressed={isSelected}
                          aria-label={isSelected ? t("Hide second detail {name}", { name: s.name }) : t("Compare details with {name}", { name: s.name })}
                          onClick={() => onToggleSecond(s.id)}
                        >
                          {isSelected ? t("Pinned 2nd") : t("+ Compare 2nd")}
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
