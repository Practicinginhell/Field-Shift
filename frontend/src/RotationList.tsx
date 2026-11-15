// The comparison in plain words: one row per rotation, saying what it is better and
// worse for than the farmer's current rotation. The full scores stay in ComparisonMatrix.

import { orderedCriteriaByWeight } from "./ComparisonMatrix";
import type { Criterion, Priorities, Strategy } from "./types";

/** A score has to move at least this many points (of 100) before we call it better or worse. */
export const NOTICEABLE_POINTS = 5;

const GOAL_IN_WORDS: Record<Criterion, string> = {
  water: "saving water",
  soil: "organic matter",
  nitrogen: "nitrogen from legumes",
  erosion: "erosion control",
  pests: "breaking pest cycles",
  forage: "livestock feed",
  income: "markets",
};

/**
 * The goals on which an option scores noticeably better or worse than the current
 * rotation, in the farmer's priority order. Goals the farmer weighted 0 are left out.
 */
export function compareInWords(
  option: Strategy,
  baseline: Strategy,
  weights: Priorities,
): { better: Criterion[]; worse: Criterion[] } {
  const better: Criterion[] = [];
  const worse: Criterion[] = [];
  for (const c of orderedCriteriaByWeight(weights)) {
    if (weights[c] === 0) continue;
    const diff = Math.round(option.scores[c] * 100) - Math.round(baseline.scores[c] * 100);
    if (diff >= NOTICEABLE_POINTS) better.push(c);
    else if (diff <= -NOTICEABLE_POINTS) worse.push(c);
  }
  return { better, worse };
}

interface Props {
  strategies: Strategy[];
  weights: Priorities;
  selectedId: string | null;
  onSelectStrategy: (id: string) => void;
}

export default function RotationList({ strategies, weights, selectedId, onSelectStrategy }: Props) {
  const ordered = [...strategies].sort((a, b) => Number(b.is_baseline) - Number(a.is_baseline));
  const baseline = ordered.find((s) => s.is_baseline) ?? ordered[0];
  let optionNumber = 0;

  return (
    <ul className="rotation-list">
      {ordered.map((s) => {
        if (!s.is_baseline) optionNumber += 1;
        const kind = s.is_baseline ? "Your current rotation" : "Option to explore";
        const words = s.is_baseline ? null : compareInWords(s, baseline, weights);
        const selected = selectedId === s.id;
        return (
          <li
            key={s.id}
            aria-label={`${kind}: ${s.name}`}
            className={["rotation-row", s.is_baseline ? "is-baseline" : "", selected ? "is-selected" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="rotation-row-main">
              <p className="kind">
                {kind}
                {!s.is_baseline && ` ${optionNumber}`}
              </p>
              <h3>{s.name}</h3>
              <p className="rotation-facts">
                Uses about {s.water_demand_mm} mm of water a year · soil covered by living plants about{" "}
                {s.cover_months} months a year
                {s.rainfed_shortfall_mm > 0 && ` · rain falls about ${s.rainfed_shortfall_mm} mm short`}
              </p>
              {s.warnings.map((w) => (
                <p key={w} className="rotation-warning">
                  {w}
                </p>
              ))}
            </div>
            {words && (
              <dl className="rotation-verdict">
                {words.better.length > 0 && (
                  <div className="better">
                    <dt>Better for</dt>
                    <dd>{words.better.map((c) => GOAL_IN_WORDS[c]).join(", ")}</dd>
                  </div>
                )}
                {words.worse.length > 0 && (
                  <div className="worse">
                    <dt>Worse for</dt>
                    <dd>{words.worse.map((c) => GOAL_IN_WORDS[c]).join(", ")}</dd>
                  </div>
                )}
                {words.better.length === 0 && words.worse.length === 0 && (
                  <div>
                    <dd>About the same as your rotation on the goals you rated.</dd>
                  </div>
                )}
              </dl>
            )}
            <button
              type="button"
              className={selected ? "secondary active" : "secondary"}
              aria-pressed={selected}
              onClick={() => onSelectStrategy(s.id)}
            >
              {s.is_baseline ? "See details" : "See why and what to check"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
