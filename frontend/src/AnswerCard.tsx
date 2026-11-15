// The answer first: one suggestion in plain words, what it changes, what only the
// farmer knows, and what to check before changing anything. The full comparison and
// the evidence follow below it.

import { money } from "./RotationList";
import type { Strategy } from "./types";

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
}

/** "a", "a and b", "a, b and c". */
function listInWords(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function marginFact(s: Strategy, currency?: string | null): string | null {
  const m = s.margin;
  if (!m) return null;
  if (m.per_acre === null) {
    const names = listInWords(m.missing.map((n) => n.toLowerCase()));
    return `Gross margin: enter your numbers for ${names} in "Your yields and prices" to see it`;
  }
  let text = `Gross margin about ${money(m.per_acre, currency)} an acre a year`;
  if (!s.is_baseline && m.vs_current !== null && m.vs_current !== 0) {
    text += `, ${money(Math.abs(m.vs_current), currency)} ${m.vs_current < 0 ? "less" : "more"} than now`;
  }
  return text;
}

export default function AnswerCard({ baseline, top, firstStep, currency, newCrops, checks, onSeeWhy }: Props) {
  const keepCurrent = !top || top.total <= baseline.total;
  const shown = keepCurrent ? baseline : top;
  const margin = marginFact(shown, currency);
  const step = !keepCurrent && firstStep && firstStep.id !== shown.id ? firstStep : null;
  const stepMoney = step?.margin?.vs_current;
  const stepText =
    step &&
    `${step.name}. Keeps your crops: soil covered about ${step.cover_months} months a year` +
      (stepMoney ? `, ${money(Math.abs(stepMoney), currency)} an acre a year ${stepMoney < 0 ? "less" : "more"} than now` : "") +
      ".";

  return (
    <section className="answer-card" aria-labelledby="answer-kind">
      <p id="answer-kind" className="kind">
        Our suggestion for your field
      </p>
      <h2>{keepCurrent ? "Your current rotation fits what you told us best" : shown.name}</h2>
      {!keepCurrent && shown.why[0] && <p className="answer-why">{shown.why[0]}</p>}
      <ul className="answer-facts">
        <li>
          Soil covered by living plants about {shown.cover_months} months a year
          {!keepCurrent && ` (now ${baseline.cover_months})`}
        </li>
        <li>
          Uses about {shown.water_demand_mm} mm of water a year
          {!keepCurrent && ` (now ${baseline.water_demand_mm})`}
        </li>
        {margin && <li>{margin}</li>}
      </ul>
      {step && (
        <div className="answer-block answer-step">
          <h3>A smaller first step</h3>
          <p>{stepText}</p>
        </div>
      )}
      {!keepCurrent && newCrops.length > 0 && (
        <div className="answer-block">
          <h3>Only you know</h3>
          <p>Is there a buyer and the equipment for {listInWords(newCrops.map((c) => c.toLowerCase()))} on your farm?</p>
        </div>
      )}
      <div className="answer-block">
        <h3>Check before you change</h3>
        <ul>
          {(keepCurrent ? [] : checks.slice(0, 2)).map((c) => (
            <li key={c}>{c}</li>
          ))}
          <li>Talk it over with your extension advisor or agronomist, and try it on one field first.</li>
        </ul>
      </div>
      <p className="answer-reminder">This is a suggestion from data, not a decision. You know your field: you make the call.</p>
      <button type="button" className="secondary" onClick={() => onSeeWhy(shown.id)}>
        See why and the evidence
      </button>
    </section>
  );
}
