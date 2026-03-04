"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { GameState } from "@/lib/types";

export type DecisionInput = {
 price: number;
 new_engineers: number;
 new_sales: number;
 salary_pct: number;
};

const money0 = new Intl.NumberFormat("en-US", { maximumFractionDigits:0 });

const OFFICE_CAPACITY =30;

function clampInt(n: number, { min, max }: { min: number; max: number }) {
 if (!Number.isFinite(n)) return min;
 return Math.max(min, Math.min(max, Math.trunc(n)));
}

/**
 * Quarter decision input form.
 * All simulation outcomes are computed server-side; this form only collects inputs.
 */
export default function DecisionForm({
 game,
 defaultPrice,
 disabled,
 onSubmit,
}: {
 game: GameState;
 defaultPrice: number;
 disabled: boolean;
 onSubmit: (input: DecisionInput) => Promise<void> | void;
}) {
 const [price, setPrice] = useState<number>(defaultPrice);
 const [newEngineers, setNewEngineers] = useState<number>(0);
 const [newSales, setNewSales] = useState<number>(0);
 const [salaryPct, setSalaryPct] = useState<number>(100);

 const currentHeadcount = (game.engineers ??0) + (game.sales_staff ??0);
 const seatsRemaining = Math.max(0, OFFICE_CAPACITY - currentHeadcount);

 const plannedHires = Math.max(0, Math.trunc(newEngineers)) + Math.max(0, Math.trunc(newSales));

 const error = useMemo((): string | null => {
 if (!Number.isFinite(price) || price <0) return "Price must be ≥0";
 if (!Number.isFinite(newEngineers) || newEngineers <0) return "Engineer hires must be ≥0";
 if (!Number.isFinite(newSales) || newSales <0) return "Sales hires must be ≥0";
 if (plannedHires > seatsRemaining) {
 return `Office capacity is ${OFFICE_CAPACITY} desks. Reduce hires or remove staff first.`;
 }
 if (!Number.isFinite(salaryPct) || salaryPct <1 || salaryPct >200) return "Salary % must be1–200";
 return null;
 }, [price, newEngineers, newSales, salaryPct, plannedHires, seatsRemaining]);

 async function submit(e: FormEvent) {
 e.preventDefault();
 if (disabled || error) return;

 await onSubmit({
 price,
 new_engineers: Math.trunc(newEngineers),
 new_sales: Math.trunc(newSales),
 salary_pct: salaryPct,
 });
 }

 const canSubmit = !disabled && !error;

 return (
 <form onSubmit={submit} style={{ display: "grid", gap:10 }}>
 <div className="ui-muted" style={{ fontSize:12 }}>
 Current: Y{game.year} Q{game.quarter}
 </div>

 <div className="ui-muted" style={{ fontSize:12 }}>
 Office seats: <b>{currentHeadcount}</b> / <b>{OFFICE_CAPACITY}</b> • Remaining: <b>{seatsRemaining}</b>
 </div>

 <label>
 Price
 <input
 type="number"
 inputMode="numeric"
 value={Number.isFinite(price) ? price :0}
 onChange={(e) => setPrice(Number(e.target.value))}
 disabled={disabled}
 min={0}
 step={10_000}
 placeholder="500000"
 aria-invalid={Boolean(error && (price <0 || !Number.isFinite(price)))}
 />
 <div className="ui-muted" style={{ fontSize:12, marginTop:4 }}>
 Formatted: ${money0.format(Math.max(0, Number.isFinite(price) ? price :0))}
 </div>
 </label>

 <label>
 Hire Engineers
 <input
 type="number"
 inputMode="numeric"
 value={Number.isFinite(newEngineers) ? newEngineers :0}
 onChange={(e) => setNewEngineers(clampInt(Number(e.target.value), { min:0, max: seatsRemaining }))}
 disabled={disabled}
 min={0}
 max={seatsRemaining}
 step={1}
 aria-invalid={Boolean(error && (newEngineers <0 || !Number.isFinite(newEngineers)))}
 />
 </label>

 <label>
 Hire Sales
 <input
 type="number"
 inputMode="numeric"
 value={Number.isFinite(newSales) ? newSales :0}
 onChange={(e) => setNewSales(clampInt(Number(e.target.value), { min:0, max: seatsRemaining }))}
 disabled={disabled}
 min={0}
 max={seatsRemaining}
 step={1}
 aria-invalid={Boolean(error && (newSales <0 || !Number.isFinite(newSales)))}
 />
 </label>

 <label>
 Salary % (100 baseline)
 <input
 type="number"
 inputMode="numeric"
 value={Number.isFinite(salaryPct) ? salaryPct :100}
 onChange={(e) => setSalaryPct(clampInt(Number(e.target.value), { min:1, max:200 }))}
 disabled={disabled}
 min={1}
 max={200}
 step={1}
 aria-invalid={Boolean(error && (salaryPct <1 || salaryPct >200 || !Number.isFinite(salaryPct)))}
 />
 <div className="ui-muted" style={{ fontSize:12, marginTop:4 }}>
 Range:1–200
 </div>
 </label>

 {error && (
 <div className="ui-muted" style={{ fontSize:12, color: "rgba(245,158,11,.95)" }}>
 {error}
 </div>
 )}

 <button type="submit" disabled={!canSubmit} aria-disabled={!canSubmit} title={error ?? undefined}>
 Advance Quarter
 </button>
 </form>
 );
}
