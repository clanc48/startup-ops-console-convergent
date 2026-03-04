import type { QuarterRow } from "@/lib/types";
import * as crypto from "crypto";

function normalizeNumericText(v: any): string {
 if (v === null || v === undefined) return "";
 let s = String(v).trim();
 if (!s.includes(".")) return s;
 s = s.replace(/0+$/, "");
 s = s.replace(/\.$/, "");
 if (s === "-0") return "0";
 return s;
}

function buildQuarterIntegrityPayloadString(args: {
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

function computeIntegrityHash(payload: string): string {
 return crypto.createHash("sha256").update(payload).digest("hex");
}

export function verifyQuarterRow2(q: QuarterRow): boolean {
 if (!q.integrity_hash) return false;

 const baseArgs = {
 game_id: String(q.game_id),
 year: Number(q.year),
 quarter: Number(q.quarter),

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

 const runNo = (q as any).run_no;
 if (runNo !== undefined && runNo !== null) {
 const payload = buildQuarterIntegrityPayloadString({ ...baseArgs, run_no: Number(runNo) });
 if (computeIntegrityHash(payload) === q.integrity_hash) return true;
 }

 const legacyPayload = buildQuarterIntegrityPayloadString(baseArgs);
 return computeIntegrityHash(legacyPayload) === q.integrity_hash;
}
