
"use client";

import { useState } from "react";
import type { GameState } from "@/lib/types";

export type DecisionInput = {
  price: number;
  new_engineers: number;
  new_sales: number;
  salary_pct: number;
};

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

  function validate(): string | null {
    if (!Number.isFinite(price) || price < 0) return "Price must be >= 0";
    if (!Number.isFinite(newEngineers) || newEngineers < 0) return "Engineer hires must be >= 0";
    if (!Number.isFinite(newSales) || newSales < 0) return "Sales hires must be >= 0";
    if (!Number.isFinite(salaryPct) || salaryPct < 1 || salaryPct > 200) return "Salary % must be 1–200";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) return alert(v);
    await onSubmit({
      price,
      new_engineers: Math.trunc(newEngineers),
      new_sales: Math.trunc(newSales),
      salary_pct: salaryPct,
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
      <div className="ui-muted" style={{ fontSize: 12 }}>Current: Y{game.year} Q{game.quarter}</div>

      <label>
        Price
        <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} disabled={disabled} />
      </label>

      <label>
        Hire Engineers
        <input type="number" value={newEngineers} onChange={(e) => setNewEngineers(Number(e.target.value))} disabled={disabled} min={0} />
      </label>

      <label>
        Hire Sales
        <input type="number" value={newSales} onChange={(e) => setNewSales(Number(e.target.value))} disabled={disabled} min={0} />
      </label>

      <label>
        Salary % (100 baseline)
        <input type="number" value={salaryPct} onChange={(e) => setSalaryPct(Number(e.target.value))} disabled={disabled} min={1} max={200} />
      </label>

      <button type="submit" disabled={disabled}>Advance Quarter</button>
    </form>
  );
}
