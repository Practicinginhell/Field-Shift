import type { CSSProperties, ReactNode } from "react";
import type { Criterion, Priorities } from "./types";
import { t } from "./i18n";

export const CRITERION_NAMES: Record<Criterion, string> = {
  water: "Save water",
  soil: "Add organic matter",
  nitrogen: "Fix nitrogen (legumes)",
  erosion: "Reduce erosion",
  pests: "Break pest cycles",
  forage: "Forage for livestock",
  income: "Market suitability",
};

const TICKS = [0, 1, 2, 3, 4, 5] as const;

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const CRITERION_ICONS: Record<Criterion, ReactNode> = {
  water: (
    <Icon>
      <path d="M8 2.1S3.6 7.1 3.6 10a4.4 4.4 0 0 0 8.8 0C12.4 7.1 8 2.1 8 2.1z" />
      <path d="M6.2 10.6a1.9 1.9 0 0 0 1.8 1.6" />
    </Icon>
  ),
  soil: (
    <Icon>
      <path d="M8 13.3V7.5" />
      <path d="M8 8.3c0-2.7 2.1-4.6 4.7-4.6 0 2.7-2 4.6-4.7 4.6z" />
      <path d="M8 9.9c0-2.1-1.7-3.7-3.9-3.7 0 2.1 1.6 3.7 3.9 3.7z" />
      <path d="M3 13.4h10" />
    </Icon>
  ),
  nitrogen: (
    <Icon>
      <circle cx="8" cy="4.4" r="2.1" />
      <circle cx="5.2" cy="8.2" r="2.1" />
      <circle cx="10.8" cy="8.2" r="2.1" />
      <path d="M8 10.1v3.7" />
    </Icon>
  ),
  erosion: (
    <Icon>
      <path d="M2.2 12.2c2-2.6 4-3.3 5.8-2.8 1.8.5 3.7 1.3 5.8 2.8" />
      <path d="M3 8.9c1.9-2.2 3.7-2.8 5.2-2.4 1.5.4 3.1 1.1 4.8 2.4" />
      <path d="M8 2.4v2.7m-1.7-1.4L8 2.2l1.7 1.5" />
    </Icon>
  ),
  pests: (
    <Icon>
      <path d="M8 2 12.7 3.8v3.9c0 3-1.9 5.2-4.7 6.3C5.2 12.9 3.3 10.7 3.3 7.7V3.8L8 2z" />
      <path d="M5.7 7.9 7.3 9.5 10.5 6" />
    </Icon>
  ),
  forage: (
    <Icon>
      <path d="M8 13.6V3.2" />
      <path d="M8 6.4 5.2 4.3" />
      <path d="M8 6.4 10.8 4.3" />
      <path d="M8 9.6 4.7 7.4" />
      <path d="M8 9.6 11.3 7.4" />
      <path d="M4.5 13.6h7" />
    </Icon>
  ),
  income: (
    <Icon>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.6v6.8" />
      <path d="M9.8 6.1a1.7 1.7 0 0 0-3.3-.2c0 1.4 3.6 1 3.6 2.6a1.8 1.8 0 0 1-3.6.3" />
    </Icon>
  ),
};

interface Props {
  priorities: Priorities;
  onChange: (priorities: Priorities) => void;
}

function rowClass(val: number): string {
  if (val === 0) return "priority-row is-zero";
  if (val >= 4) return "priority-row is-high";
  return "priority-row";
}

export default function PrioritySliders({ priorities, onChange }: Props) {
  return (
    <div className="priorities">
      <p className="hint">{t("0 = skip, 5 = top priority. It sets how much each goal weighs.")}</p>
      <div className="priority-list">
        {(Object.keys(CRITERION_NAMES) as Criterion[]).map((c) => {
          const val = priorities[c];
          return (
            <label key={c} className={rowClass(val)} data-criterion={c}>
              <span className="priority-name">
                <span className="priority-badge" aria-hidden="true">
                  {CRITERION_ICONS[c]}
                </span>
                <span className="priority-label-text">{t(CRITERION_NAMES[c])}</span>
              </span>
              <span className="priority-slider-wrap">
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={1}
                  value={val}
                  aria-label={t(CRITERION_NAMES[c])}
                  style={{ "--pct": `${val * 20}%` } as CSSProperties}
                  onChange={(e) => onChange({ ...priorities, [c]: Number(e.target.value) })}
                />
                <span className="priority-ticks" aria-hidden="true">
                  {TICKS.map((step) => (
                    <span key={step} className="priority-tick" data-active={step <= val ? "true" : "false"} />
                  ))}
                </span>
              </span>
              <output className="priority-value">{val}</output>
            </label>
          );
        })}
      </div>
    </div>
  );
}
