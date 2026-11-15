import type { ReactNode } from "react";

export type FarmerControl = "priorities" | "water" | "crops" | "numbers";

interface Props {
  goals: string;
  irrigated: boolean;
  ruledOut: string[];
  /** Where the margin numbers come from, in words; omitted when there are no margins. */
  numbersSource?: string;
  onOpen: (control: FarmerControl) => void;
}

const CONTROL_ICONS: Record<FarmerControl, ReactNode> = {
  priorities: (
    <svg className="your-call-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="5.5" cy="4.5" r="1.4" fill="currentColor" />
      <circle cx="10.5" cy="8" r="1.4" fill="currentColor" />
      <circle cx="6.5" cy="11.5" r="1.4" fill="currentColor" />
    </svg>
  ),
  water: (
    <svg className="your-call-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.1S3.7 7 3.7 10a4.3 4.3 0 0 0 8.6 0C12.3 7 8 2.1 8 2.1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),
  crops: (
    <svg className="your-call-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.2 11.8 11.8 4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  numbers: (
    <svg className="your-call-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9.8 6.2c-.3-.6-1-1-1.8-1-1 0-1.8.6-1.8 1.4 0 1.9 3.6 1 3.6 2.9 0 .8-.8 1.4-1.8 1.4-.8 0-1.5-.4-1.8-1M8 4.2v7.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
};

/**
 * Names the choices only the farmer can make, next to the options they shape, and
 * opens the control that changes each one.
 */
export default function YourCall({ goals, irrigated, ruledOut, numbersSource, onOpen }: Props) {
  const items: { control: FarmerControl; label: string; value: string; action: string }[] = [
    {
      control: "priorities",
      label: "What matters most:",
      value: goals,
      action: "Change what matters most",
    },
    {
      control: "water",
      label: "Your water:",
      value: irrigated ? "Irrigated" : "Rainfed",
      action: "Change your water",
    },
    {
      control: "crops",
      label: "Crops you can't grow or sell:",
      value: ruledOut.length ? `Ruled out: ${ruledOut.join(", ")}` : "No crops ruled out",
      action: "Rule out crops you can't grow or sell",
    },
  ];
  if (numbersSource !== undefined) {
    items.push({
      control: "numbers",
      label: "Yields and prices:",
      value: numbersSource,
      action: "Enter your yields and prices",
    });
  }

  return (
    <section className="your-call" aria-labelledby="your-call-title">
      <h3 id="your-call-title">Your call</h3>
      <p className="hint">
        These options come from NASA data and general crop facts. You know things the data doesn't. Change any of
        these and the comparison updates.
      </p>
      <ul className="your-call-grid">
        {items.map((item) => (
          <li key={item.control} className="your-call-card">
            <span className="your-call-choice">
              <strong className="your-call-label">{item.label}</strong>
              <span className="your-call-value">{item.value}</span>
            </span>
            <button type="button" className="secondary your-call-btn" onClick={() => onOpen(item.control)}>
              {CONTROL_ICONS[item.control]}
              <span>{item.action}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">Then take the option you like to your extension advisor or agronomist.</p>
    </section>
  );
}
