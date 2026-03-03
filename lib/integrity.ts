import crypto from "crypto";

export function buildQuarterIntegrityPayloadString(args: {
  game_id: string;
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
  // Deterministic, stable payload string (matches the Postgres concat_ws('|', ...) used in advance_game()).
  // NOTE: This is an integrity checksum (detect accidental corruption), not an anti-tamper mechanism.
  return [
    String(args.game_id),
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
    String(args.quality_end),
  ].join("|");
}

export function computeIntegrityHash(payload: string): string {
  return crypto.createHash("sha256").update(payload).digest("hex");
}
