import { useState } from "react";
import { MONTH_NAMES } from "./season";
import { t } from "./i18n";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

interface Props {
  rain: number[];
  et0: number[];
  selectedMonth?: number | null;
  onSelectMonth?: (monthIndex: number) => void;
}

/** Interactive monthly rain against reference evapotranspiration, as paired bars. */
export default function MonthlyWaterChart({ rain, et0, selectedMonth, onSelectMonth }: Props) {
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);
  const [localSelectedMonth, setLocalSelectedMonth] = useState<number | null>(null);

  const pinnedMonth = selectedMonth !== undefined ? selectedMonth : localSelectedMonth;
  const activeMonth = hoveredMonth ?? pinnedMonth;

  const max = Math.max(...rain, ...et0, 1);
  const padLeft = 48;
  const padTop = 10;
  const height = 112;
  const slot = 25;
  const bar = 9;
  const bottom = padTop + height;
  const svgWidth = padLeft + slot * 12 + 4;
  const svgHeight = bottom + 26;
  const y = (v: number) => bottom - (v / max) * height;

  const selectMonth = (monthIndex: number) => {
    setLocalSelectedMonth(monthIndex);
    onSelectMonth?.(monthIndex);
  };

  const activeRain = activeMonth !== null ? Math.round(rain[activeMonth]) : 0;
  const activeEt0 = activeMonth !== null ? Math.round(et0[activeMonth]) : 0;
  const activeDiff = activeRain - activeEt0;

  return (
    <figure className="chart">
      <div className="chart-head">
        <span className="chart-title">{t("Monthly water balance")}</span>
        <span className="chart-badge">{t("Click any month to inspect & jump 3D view")}</span>
      </div>
      <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} role="group" aria-labelledby="water-chart-title">
        <title id="water-chart-title">{t("Average rain and evaporation demand by month")}</title>
        <line className="grid-line" x1={padLeft} y1={y(max)} x2={svgWidth - 2} y2={y(max)} />
        <line className="grid-line" x1={padLeft} y1={y(max / 2)} x2={svgWidth - 2} y2={y(max / 2)} />
        <line className="grid-line" x1={padLeft} y1={bottom} x2={svgWidth - 2} y2={bottom} />
        <text className="grid-label" x={padLeft - 5} y={y(max) + 3} textAnchor="end">
          {Math.round(max)} mm
        </text>
        <text className="grid-label" x={padLeft - 5} y={y(max / 2) + 3} textAnchor="end">
          {Math.round(max / 2)} mm
        </text>
        <text className="grid-label" x={padLeft - 5} y={bottom + 3} textAnchor="end">
          0 mm
        </text>
        {MONTHS.map((m, i) => {
          const sx = padLeft + i * slot;
          const isActive = activeMonth === i;
          const isSelected = pinnedMonth === i;
          const slotClasses = ["month-slot", isActive ? "active" : "", isSelected ? "selected" : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <g
              key={i}
              className={slotClasses}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={t("{month}: Rain {rain} mm, evaporation demand {et0} mm", { month: t(MONTH_NAMES[i]), rain: Math.round(rain[i]), et0: Math.round(et0[i]) })}
              onMouseEnter={() => setHoveredMonth(i)}
              onMouseLeave={() => setHoveredMonth((prev) => (prev === i ? null : prev))}
              onFocus={() => setHoveredMonth(i)}
              onBlur={() => setHoveredMonth((prev) => (prev === i ? null : prev))}
              onClick={() => selectMonth(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectMonth(i);
                }
              }}
            >
              <rect className="month-hit" x={sx + 1} y={padTop - 2} width={slot - 2} height={height + 24} rx={5} />
              <rect className="rain" x={sx + 3} y={y(rain[i])} width={bar} height={bottom - y(rain[i])} rx={2}>
                <title>{t("Rain {mm} mm", { mm: Math.round(rain[i]) })}</title>
              </rect>
              <rect className="et0" x={sx + 3 + bar + 1} y={y(et0[i])} width={bar} height={bottom - y(et0[i])} rx={2}>
                <title>{t("Evaporation demand {mm} mm", { mm: Math.round(et0[i]) })}</title>
              </rect>
              <rect className="month-pill" x={sx + 2} y={bottom + 4} width={slot - 4} height={16} rx={4} />
              <text className="month-label" x={sx + slot / 2} y={bottom + 15} textAnchor="middle">
                {m}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        <span className="key rain" /> {t("Rain")} <span className="key et0" /> {t("Water the air can take up (mm per month)")}
      </figcaption>
      <div className="chart-readout" aria-live="polite">
        {activeMonth !== null ? (
          <>
            <strong>{t(MONTH_NAMES[activeMonth])}</strong>
            <span>{t("Rain {mm} mm", { mm: activeRain })}</span>
            <span>{t("Evaporation demand {mm} mm", { mm: activeEt0 })}</span>
            <span className={activeDiff < 0 ? "water-deficit" : "water-surplus"}>
              {activeDiff < 0
                ? t("{mm} mm deficit (crops draw on soil water)", { mm: Math.abs(activeDiff) })
                : t("+{mm} mm surplus", { mm: activeDiff })}
            </span>
            <span className="chart-sync-tag">{pinnedMonth === activeMonth ? t("Viewing in 3D ↓") : t("Click to jump 3D ↓")}</span>
          </>
        ) : (
          <span className="chart-prompt">{t("Hover or click a month to inspect its water balance and jump the 3D view.")}</span>
        )}
      </div>
    </figure>
  );
}
