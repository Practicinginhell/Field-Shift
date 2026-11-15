// The comparison in plain words: one row per rotation, saying what it is better and
// worse for than the farmer's current rotation. The full scores stay in ComparisonMatrix.

import { orderedCriteriaByWeight } from "./ComparisonMatrix";
import type { Criterion, Priorities, Strategy } from "./types";
import { getLang, num, t } from "./i18n";

/**
 * "$467" for U.S. dollars (and the farmer's own numbers), "C$383" for Canadian; in
 * French "467 $" and "383 $ CA".
 */
export function money(amount: number, currency?: string | null): string {
  const sign = amount < 0 ? "-" : "";
  const value = Math.abs(Math.round(amount));
  if (getLang() === "fr") return `${sign}${value.toLocaleString("fr-CA")} ${currency === "CAD" ? "$ CA" : "$"}`;
  return `${sign}${currency === "CAD" ? "C$" : "$"}${value.toLocaleString("en-US")}`;
}

/** The margin line for one rotation, in plain words. */
export function marginText(s: Strategy, currency?: string | null): string | null {
  const m = s.margin;
  if (!m) return null;
  if (m.per_acre === null) return t("Needs your numbers for: {crops}, to show a gross margin.", { crops: m.missing.join(", ") });
  let text = t("Gross margin about {money} an acre a year", { money: money(m.per_acre, currency) });
  if (!s.is_baseline && m.vs_current !== null) {
    const diff = money(Math.abs(m.vs_current), currency);
    text +=
      m.vs_current === 0
        ? t(" · about the same as yours")
        : m.vs_current < 0
          ? t(" · {money} less than yours", { money: diff })
          : t(" · {money} more than yours", { money: diff });
  }
  return text;
}

/** A score has to move at least this many points (of 100) before we call it better or worse. */
export const NOTICEABLE_POINTS = 5;

export const GOAL_IN_WORDS: Record<Criterion, string> = {
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
  /** "USD", "CAD", or none when the margins use the farmer's own numbers. */
  currency?: string | null;
  /** On an irrigated field the gap between rain and crop use is irrigation water. */
  irrigated?: boolean;
  selectedId: string | null;
  onSelectStrategy: (id: string) => void;
}

export default function RotationList({ strategies, weights, currency, irrigated, selectedId, onSelectStrategy }: Props) {
  const ordered = [...strategies].sort((a, b) => Number(b.is_baseline) - Number(a.is_baseline));
  const baseline = ordered.find((s) => s.is_baseline) ?? ordered[0];
  let optionNumber = 0;

  return (
    <ul className="rotation-list">
      {ordered.map((s) => {
        if (!s.is_baseline) optionNumber += 1;
        const kind = s.is_baseline ? t("Your current rotation") : t("Option to explore");
        const words = s.is_baseline ? null : compareInWords(s, baseline, weights);
        const selected = selectedId === s.id;
        const margin = marginText(s, currency);
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
                {t("Uses about {mm} mm of water a year · soil covered by living plants about {months} months a year", {
                  mm: s.water_demand_mm,
                  months: num(s.cover_months),
                })}
                {s.rainfed_shortfall_mm > 0 &&
                  (irrigated
                    ? t(" · needs about {mm} mm of irrigation a year", { mm: s.rainfed_shortfall_mm })
                    : t(" · rain falls about {mm} mm short", { mm: s.rainfed_shortfall_mm }))}
              </p>
              {margin && (
                <p className={s.margin?.per_acre === null ? "rotation-margin is-missing" : "rotation-margin"}>{margin}</p>
              )}
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
                    <dt>{t("Better for")}</dt>
                    <dd>{words.better.map((c) => t(GOAL_IN_WORDS[c])).join(", ")}</dd>
                  </div>
                )}
                {words.worse.length > 0 && (
                  <div className="worse">
                    <dt>{t("Worse for")}</dt>
                    <dd>{words.worse.map((c) => t(GOAL_IN_WORDS[c])).join(", ")}</dd>
                  </div>
                )}
                {words.better.length === 0 && words.worse.length === 0 && (
                  <div>
                    <dd>{t("About the same as your rotation on the goals you rated.")}</dd>
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
              {s.is_baseline ? t("See details") : t("See why and what to check")}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
