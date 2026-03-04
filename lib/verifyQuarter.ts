import type { QuarterRow } from "@/lib/types";
import { buildQuarterIntegrityPayloadString, computeIntegrityHash } from "@/lib/integrity";

function normalizeNumericText(v: any): string {
  // Match Postgres' typical NUMERIC text formatting by stripping trailing zeros.
  // Examples:
  // - "100.00" -> "100"
  // - "100.0" -> "100"
  // - "0.5000" -> "0.5"
  if (v === null || v === undefined) return "";
  let s = String(v).trim();
  if (!s.includes(".")) return s;
  // Trim trailing zeros
  s = s.replace(/0+$/, "");
  // If we ended with a dot, remove it
  s = s.replace(/\.$/, "");
  // Normalize -0 to0
  if (s === "-0") return "0";
  return s;
}

export function verifyQuarterRow(q: QuarterRow): boolean {
  if (!q.integrity_hash) return false;

  const baseArgs = {
    game_id: String(q.game_id),
    year: Number(q.year),
    quarter: Number(q.quarter),

    // IMPORTANT: Supabase returns Postgres NUMERIC as strings.
    // Normalize numeric text to avoid formatting drift.
    price: normalizeNumericText(q.price),
    new_engineers: Number(q.new_engineers),
    new_sales: Number(q.new_sales),
    salary_pct: normalizeNumericText(q.salary_pct),

    demand: normalizeNumericText(q.demand),
    units: Number(q.units),
    revenue: normalizeNumericText(q.revenue),
    payroll: normalizeNumericText(q.payroll),
    net_income: normalizeNumericText(q.net_income),
    cash_end: normalizeNumericText(q.cash_end),
    quality_end: Number(q.quality_end),
  };

  // Current format (includes run_no).
  const runNo = (q as any).run_no;
  if (runNo !== undefined && runNo !== null) {
    const payload = buildQuarterIntegrityPayloadString({
      ...baseArgs,
      run_no: Number(runNo),
    });
    if (computeIntegrityHash(payload) === q.integrity_hash) return true;
  }

  // Legacy format (no run_no).
  const legacyPayload = buildQuarterIntegrityPayloadString(baseArgs);
  return computeIntegrityHash(legacyPayload) === q.integrity_hash;
}
