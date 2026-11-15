// The answer first: one suggestion in plain words, what it changes, what only the
// farmer knows, and what to check before changing anything. The full comparison and
// the evidence follow below it.

import { money } from "./RotationList";
import type { Strategy } from "./types";
import { num, t } from "./i18n";

interface Props {
  baseline: Strategy;
  /** The best-scoring alternative, if any. */
  top: Strategy | undefined;
  /** The farmer's own rotation plus a winter cover crop, when it is among the options. */
  firstStep?: Strategy;
  currency?: string | null;
  /** Names of the suggestion's crops the farmer doesn't grow today. */
  newCrops: string[];
  /** Checks for this suggestion only; checks shared by every option are listed once below. */
  checks: string[];
  onSeeWhy: (id: string) => void;
  onSeeSeasons?: () => void;
}

/** "a", "a and b", "a, b and c". */
function listInWords(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${t("and")} ${items[items.length - 1]}`;
}

function marginFact(s: Strategy, currency?: string | null): string | null {
  const m = s.margin;
  if (!m) return null;
  if (m.per_acre === null) {
    const names = listInWords(m.missing.map((n) => n.toLowerCase()));
    return t('Gross margin: enter your numbers for {crops} in "Your yields and prices" to see it', { crops: names });
  }
  let text = t("Gross margin about {money} an acre a year", { money: money(m.per_acre, currency) });
  if (!s.is_baseline && m.vs_current !== null && m.vs_current !== 0) {
    const diff = money(Math.abs(m.vs_current), currency);
    text += m.vs_current < 0 ? t(", {money} less than now", { money: diff }) : t(", {money} more than now", { money: diff });
  }
  return text;
}

export default function AnswerCard({ baseline, top, firstStep, currency, newCrops, checks, onSeeWhy, onSeeSeasons }: Props) {
  const keepCurrent = !top || top.total <= baseline.total;
  const shown = keepCurrent ? baseline : top;
  const margin = marginFact(shown, currency);
  const step = !keepCurrent && firstStep && firstStep.id !== shown.id ? firstStep : null;
  const stepMoney = step?.margin?.vs_current;
  const stepMoneyText = stepMoney
    ? stepMoney < 0
      ? t(", {money} an acre a year less than now", { money: money(Math.abs(stepMoney), currency) })
      : t(", {money} an acre a year more than now", { money: money(Math.abs(stepMoney), currency) })
    : "";
  const stepText =
    step &&
    t("{name}. Keeps your crops: soil covered about {months} months a year", { name: step.name, months: num(step.cover_months) }) +
      stepMoneyText +
      ".";

  return (
    <section className="answer-card" aria-labelledby="answer-kind">
      <p id="answer-kind" className="kind">
        {t("Our suggestion for your field")}
      </p>
      <h2>{keepCurrent ? t("Your current rotation fits what you told us best") : shown.name}</h2>
      {!keepCurrent && shown.why[0] && <p className="answer-why">{shown.why[0]}</p>}
      <ul className="answer-facts">
        <li>
          {t("Soil covered by living plants about {months} months a year", { months: num(shown.cover_months) })}
          {!keepCurrent && t(" (now {n})", { n: num(baseline.cover_months) })}
        </li>
        <li>
          {t("Uses about {mm} mm of water a year", { mm: shown.water_demand_mm })}
          {!keepCurrent && t(" (now {n})", { n: baseline.water_demand_mm })}
        </li>
        {margin && <li>{margin}</li>}
      </ul>
      {step && (
        <div className="answer-block answer-step">
          <h3>{t("A smaller first step")}</h3>
          <p>{stepText}</p>
        </div>
      )}
      {!keepCurrent && newCrops.length > 0 && (
        <div className="answer-block">
          <h3>{t("Only you know")}</h3>
          <p>
            {t("Is there a buyer and the equipment for {crops} on your farm?", {
              crops: listInWords(newCrops.map((c) => c.toLowerCase())),
            })}
          </p>
        </div>
      )}
      <div className="answer-block">
        <h3>{t("Check before you change")}</h3>
        <ul>
          {(keepCurrent ? [] : checks.slice(0, 2)).map((c) => (
            <li key={c}>{c}</li>
          ))}
          <li>{t("Talk it over with your extension advisor or agronomist, and try it on one field first.")}</li>
        </ul>
      </div>
      <p className="answer-reminder">
        {t("This is a suggestion from data, not a decision. You know your field: you make the call.")}
      </p>
      <div className="answer-actions">
        <button type="button" className="secondary" onClick={() => onSeeWhy(shown.id)}>
          {t("See why and the evidence")}
        </button>
        {onSeeSeasons && (
          <button type="button" className="secondary" onClick={onSeeSeasons}>
            {t("See through the seasons (3D)")}
          </button>
        )}
      </div>
    </section>
  );
}
