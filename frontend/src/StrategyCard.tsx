import { CRITERION_NAMES } from "./PrioritySliders";
import ScoreBar from "./ScoreBar";
import type { Criterion, Strategy } from "./types";
import { num, t } from "./i18n";

export const SUPPORT_LABEL = {
  "field-level": "your field",
  regional: "wider area",
  "general reference": "general reference",
  "farmer input": "your input",
};

const SUPPORT_CLASS = {
  "field-level": "support-tag support-field",
  regional: "support-tag support-regional",
  "general reference": "support-tag support-reference",
  "farmer input": "support-tag support-input",
} as const;

/**
 * Separates "Check locally" bullets that repeat across every strategy into one
 * shared list, keeping only strategy-specific checks per option.
 */
export function splitSharedLocalReview(strategies: Strategy[]): {
  shared: string[];
  perStrategy: Map<string, string[]>;
} {
  const perStrategy = new Map<string, string[]>();
  if (strategies.length <= 1) {
    for (const s of strategies) perStrategy.set(s.id, s.local_review);
    return { shared: [], perStrategy };
  }
  const counts = new Map<string, number>();
  const ordered: string[] = [];
  for (const s of strategies) {
    for (const item of new Set(s.local_review)) {
      if (!counts.has(item)) ordered.push(item);
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }
  const sharedSet = new Set(ordered.filter((item) => counts.get(item) === strategies.length));
  const shared = ordered.filter((item) => sharedSet.has(item));
  for (const s of strategies) {
    perStrategy.set(
      s.id,
      s.local_review.filter((item) => !sharedSet.has(item)),
    );
  }
  return { shared, perStrategy };
}

/** General good practice for any rotation change; it does not come from the field's data. */
const TRIAL_STEP = () =>
  t("Try it on one field or part of a field first, and compare it with your usual rotation before changing more.");

interface Props {
  strategy: Strategy;
  optionIndex?: number;
  optionPrefix?: string;
  variant?: "card" | "detail";
  baselineScores?: Record<Criterion, number>;
  localChecks?: string[];
  isComparedIn3D?: boolean;
  onSelectFor3D?: (id: string) => void;
  /** Crops new to the farmer's rotation; only the farmer knows if they can grow and sell them. */
  cropQuestions?: { key: string; name: string; confirmed: boolean }[];
  onCropAnswer?: (key: string, canGrow: boolean) => void;
  /** Crop names in the page's language, by key. */
  cropNames?: Record<string, string>;
}

export default function StrategyCard({
  strategy,
  optionIndex,
  optionPrefix,
  variant = "card",
  baselineScores,
  localChecks,
  isComparedIn3D,
  onSelectFor3D,
  cropQuestions = [],
  onCropAnswer,
  cropNames,
}: Props) {
  const cropName = (key: string) =>
    cropNames?.[key]?.replace(" (grain)", "").toLowerCase() ?? key.replaceAll("_", " ");
  const s = strategy;
  const checks = localChecks ?? s.local_review;
  const isDetail = variant === "detail";
  // An option's detail turns its local checks into steps; the current rotation is not a change.
  const changeSteps = isDetail && !s.is_baseline;
  const kindLabel = isDetail
    ? s.is_baseline
      ? t("Details · Current rotation")
      : optionPrefix
        ? t("Details · {option}", { option: optionPrefix })
        : t("Details · Option")
    : s.is_baseline
      ? t("Your current rotation")
      : t("Option to explore");
  const titleText = isDetail && optionPrefix && !s.is_baseline ? `${optionPrefix} · ${s.name}` : s.name;

  return (
    <article className={s.is_baseline ? "card baseline" : "card"}>
      <header>
        <div className="card-top">
          <p className="kind">{kindLabel}</p>
          {!s.is_baseline && onSelectFor3D ? (
            <button
              type="button"
              className={isComparedIn3D ? "secondary active" : "secondary"}
              aria-pressed={Boolean(isComparedIn3D)}
              onClick={() => onSelectFor3D(s.id)}
            >
              {isComparedIn3D ? t("Showing in 3D") : t("Compare in 3D")}
            </button>
          ) : (
            !s.is_baseline && optionIndex !== undefined && <span className="card-opt-badge">{t("Opt {n}", { n: optionIndex })}</span>
          )}
        </div>
        <h3>{titleText}</h3>
        <div className="rotation-pills" aria-label={t("Rotation sequence")}>
          {s.years.map((y, i) => (
            <span key={i} className={y.cover ? "pill cover" : "pill"}>
              {t("Yr {n}: {crop}", { n: i + 1, crop: cropName(y.crop) })}
              {y.cover ? t(" + cover") : ""}
            </span>
          ))}
        </div>
        {!isDetail && (
          <p className="total">
            {t("Fit with your priorities:")} <strong>{Math.round(s.total * 100)}</strong> / 100
          </p>
        )}
      </header>

      {s.warnings.length > 0 && (
        <div className="warning" role="alert">
          {s.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      {/* The detail panel sits under the comparison, which already holds every score and the yearly facts. */}
      {!isDetail && (
        <dl className="scores">
          {(Object.keys(CRITERION_NAMES) as Criterion[]).map((c) => (
            <div key={c}>
              <dt>{t(CRITERION_NAMES[c])}</dt>
              <dd>
                <ScoreBar
                  label={t(CRITERION_NAMES[c])}
                  score={s.scores[c]}
                  baselineScore={!s.is_baseline && baselineScores ? baselineScores[c] : undefined}
                  showDelta={!s.is_baseline && Boolean(baselineScores)}
                />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {!isDetail && (
        <p className="facts">
          {t("Water use about {mm} mm a year · living cover about {months} months a year", {
            mm: s.water_demand_mm,
            months: num(s.cover_months),
          })}
          {s.rainfed_shortfall_mm > 0 && t(" · rain falls short by about {mm} mm", { mm: s.rainfed_shortfall_mm })}
        </p>
      )}

      <section>
        <h4>{t("Why it was suggested")}</h4>
        {s.why.map((t) => (
          <p key={t}>{t}</p>
        ))}
      </section>
      <section>
        <h4>{t("Possible benefits")}</h4>
        <ul>
          {s.benefits.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
      {onCropAnswer && cropQuestions.length > 0 && (
        <section className="farmer-questions">
          <h4>{t("Only you know")}</h4>
          <ul>
            {cropQuestions.map((q) =>
              q.confirmed ? (
                <li key={q.key}>✓ {t("You can grow and sell {crop}.", { crop: q.name })}</li>
              ) : (
                <li key={q.key}>
                  <span>{t("Can you grow and sell {crop} here: a buyer or your own use, and the equipment?", { crop: q.name })}</span>
                  <span className="answer-buttons">
                    <button
                      type="button"
                      className="secondary"
                      aria-label={t("Yes, I can grow and sell {crop}", { crop: q.name })}
                      onClick={() => onCropAnswer(q.key, true)}
                    >
                      {t("Yes")}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      aria-label={t("No, rule out {crop}", { crop: q.name })}
                      onClick={() => onCropAnswer(q.key, false)}
                    >
                      {t("No, rule it out")}
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        </section>
      )}
      {changeSteps ? (
        <section className="review">
          <h4 id={`steps-${s.id}`}>{t("Before you change anything")}</h4>
          <ol aria-labelledby={`steps-${s.id}`}>
            {[...checks, TRIAL_STEP()].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <button type="button" className="secondary print-button" onClick={() => window.print()}>
            {t("Print for my advisor")}
          </button>
        </section>
      ) : (
        checks.length > 0 && (
          <section className="review">
            <h4>{isDetail ? t("Check locally for this option") : t("Check locally")}</h4>
            <ul>
              {checks.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        )
      )}
      <details>
        <summary>{t("Evidence ({n})", { n: s.evidence.length })}</summary>
        <ul className="evidence">
          {s.evidence.map((e) => (
            <li key={e.variable}>
              <strong>{t("{label}:", { label: e.variable })}</strong> {e.value}
              {e.url ? (
                <a
                  className={`source ${SUPPORT_CLASS[e.support]}`}
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {e.dataset}, {e.period} · {t(SUPPORT_LABEL[e.support])}
                  <span aria-hidden="true"> ↗</span>
                </a>
              ) : (
                <span className={`source ${SUPPORT_CLASS[e.support]}`}>
                  {e.dataset}, {e.period} · {t(SUPPORT_LABEL[e.support])}
                </span>
              )}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>{t("What we don't know ({n})", { n: s.gaps.length })}</summary>
        <ul>
          {s.gaps.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}
