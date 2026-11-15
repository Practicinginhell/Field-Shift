// The yields, prices and costs behind each rotation's gross margin: the regional budget's
// by default, and the farmer's own once they type them. Only the farmer knows their
// yields and their buyer's price.

import { useState } from "react";
import { t } from "./i18n";

import type { TypedNumbers } from "./margin";
import type { CropNumbers, Economics } from "./types";

interface Props {
  economics: Economics;
  /**
   * Called on every keystroke: the numbers to show margins with now, and which of them
   * are the farmer's own (sent with the next comparison).
   */
  onChange: (typed: TypedNumbers, own: Record<string, CropNumbers>, ownCoverCost: number | null) => void;
}

type Row = { yield_per_acre: string; price: string; cost_per_acre: string };

const text = (v: number | null) => (v === null ? "" : String(v));

const UNIT_WORDS: Record<string, string> = { bu: "bu", t: "tonne", ton: "ton" };
const unitWord = (u: string) => t(UNIT_WORDS[u] ?? u);

export default function YourNumbers({ economics, onChange }: Props) {
  const symbol = economics.currency === "CAD" ? t("C$") : "$";
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      economics.crops.map((c) => [
        c.crop,
        { yield_per_acre: text(c.yield_per_acre), price: text(c.price), cost_per_acre: text(c.cost_per_acre) },
      ]),
    ),
  );
  const [cover, setCover] = useState(text(economics.cover_crop_cost));

  // A number the farmer can use: empty, negative or half-typed values count as missing.
  const valueOf = (v: string) => {
    const n = v.trim() === "" ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const report = (nextRows: Record<string, Row>, nextCover: string) => {
    const numbers: Record<string, CropNumbers> = {};
    const own: Record<string, CropNumbers> = {};
    for (const c of economics.crops) {
      const r = nextRows[c.crop];
      const [y, p, cost] = [r.yield_per_acre, r.price, r.cost_per_acre].map(valueOf);
      if (y === null || p === null || cost === null) continue;
      numbers[c.crop] = { yield_per_acre: y, price: p, cost_per_acre: cost };
      const unchanged = !c.own && y === c.yield_per_acre && p === c.price && cost === c.cost_per_acre;
      if (!unchanged) own[c.crop] = numbers[c.crop];
    }
    const coverCost = valueOf(nextCover);
    onChange({ numbers, coverCost }, own, coverCost !== economics.cover_crop_cost ? coverCost : null);
  };

  const set = (crop: string, field: keyof Row, value: string) => {
    const next = { ...rows, [crop]: { ...rows[crop], [field]: value } };
    setRows(next);
    report(next, cover);
  };

  const setCoverText = (value: string) => {
    setCover(value);
    report(rows, value);
  };

  return (
    <details id="control-numbers" tabIndex={-1} className="your-numbers">
      <summary>{t("Your yields and prices")}</summary>
      <div className="your-numbers-body">
        <p className="hint">
          {economics.region
            ? t("Filled in from the {region} budget. Type your own numbers over them.", { region: economics.region })
            : t("There is no current published budget here. Enter your own numbers for each crop.")}{" "}
          {economics.basis}
        </p>
        <div className="table-wrap">
          <table className="your-numbers-table">
            <thead>
              <tr>
                <th scope="col">{t("Crop")}</th>
                <th scope="col">{t("Yield per acre")}</th>
                <th scope="col">{t("Price")}</th>
                <th scope="col">{t("Cost per acre")}</th>
              </tr>
            </thead>
            <tbody>
              {economics.crops.map((c) => {
                const unit = unitWord(c.unit);
                return (
                  <tr key={c.crop}>
                    <th scope="row">{c.name}</th>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        aria-label={t("{crop} yield, {unit} per acre", { crop: c.name, unit })}
                        value={rows[c.crop].yield_per_acre}
                        onChange={(e) => set(c.crop, "yield_per_acre", e.target.value)}
                      />{" "}
                      {unit}
                    </td>
                    <td>
                      {symbol}
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        aria-label={t("{crop} price, {symbol} per {unit}", { crop: c.name, symbol, unit })}
                        value={rows[c.crop].price}
                        onChange={(e) => set(c.crop, "price", e.target.value)}
                      />{" "}
                      / {unit}
                    </td>
                    <td>
                      {symbol}
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        aria-label={t("{crop} cost, {symbol} per acre", { crop: c.name, symbol })}
                        value={rows[c.crop].cost_per_acre}
                        onChange={(e) => set(c.crop, "cost_per_acre", e.target.value)}
                      />
                    </td>
                  </tr>
                );
              })}
              <tr>
                <th scope="row">{t("Winter rye cover")}</th>
                <td colSpan={2} className="muted">
                  {t("Seed, seeding and ending it in spring")}
                </td>
                <td>
                  {symbol}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    aria-label={t("Winter rye cover cost, {symbol} per acre", { symbol })}
                    value={cover}
                    onChange={(e) => setCoverText(e.target.value)}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="hint">{t("The margins above and below update as you type.")}</p>
        {economics.sources.length > 0 && (
          <details className="your-numbers-sources">
            <summary>{t("Where these numbers come from")}</summary>
            <ul>
              {economics.sources.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </details>
  );
}
