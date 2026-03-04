import * as crypto from "crypto";

export function buildQuarterIntegrityPayloadString(args: {
  game_id: string;
  run_no?: number;
  year: number;
  quarter: number;

  price: string | number;
  new_engineers: number;
  new_sales: number;
  salary_pct: string | number;

  demand: string | number;
  units: number;
  revenue: string | number;
  payroll: string | number;
  net_income: string | number;
  cash_end: string | number;
  quality_end: number;
}) {
  // Deterministic, stable payload string.
  // Matches the Postgres concat_ws('|', ...) used in advance_game().
  // NOTE: This is an integrity checksum (detect accidental corruption), not an anti-tamper mechanism.

  const parts: string[] = [String(args.game_id)];
  if (args.run_no !== undefined) parts.push(String(args.run_no));

  parts.push(
    String(args.year),
    String(args.quarter),

    String(args.price),
    String(args.new_engineers),
    String(args.new_sales),
    String(args.salary_pct),

    String(args.demand),
    String(args.units),
    String(args.revenue),
    String(args.payroll),
    String(args.net_income),
    String(args.cash_end),
    String(args.quality_end)
  );

  return parts.join("|");
}

export function computeIntegrityHash(payload: string): string {
  return crypto.createHash("sha256").update(payload).digest("hex");
}
