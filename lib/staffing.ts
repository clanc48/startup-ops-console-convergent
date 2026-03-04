import type { QuarterRow } from "@/lib/types";

export type StaffTotals = {
 engineers: number;
 sales: number;
};

export type StaffEventRow = {
 delta_engineers: number;
 delta_sales: number;
 created_at: string;
};

export function computeStaffTotalsByEvents(args: {
 // events must be oldest -> newest
 eventsOldestFirst: StaffEventRow[];
 start: StaffTotals;
}): StaffTotals[] {
 const { eventsOldestFirst, start } = args;

 let e = Math.max(0, Math.trunc(start.engineers));
 let s = Math.max(0, Math.trunc(start.sales));

 const totals: StaffTotals[] = [];
 for (const ev of eventsOldestFirst) {
 e = Math.max(0, e + Math.trunc(Number(ev.delta_engineers ??0)));
 s = Math.max(0, s + Math.trunc(Number(ev.delta_sales ??0)));
 totals.push({ engineers: e, sales: s });
 }
 return totals;
}

export function computeStaffTotalsByQuarterEstimate(args: {
 // quarters must be oldest -> newest for the current run
 quartersOldestFirst: QuarterRow[];
 // current snapshot totals
 current: StaffTotals;
}): StaffTotals[] {
 const { quartersOldestFirst, current } = args;

 // Walk backwards from the current snapshot by subtracting ledger deltas.
 // This is only authoritative if removals are also recorded as deltas.
 const out: StaffTotals[] = new Array(quartersOldestFirst.length);

 let engNow = Math.max(0, Math.trunc(current.engineers));
 let salesNow = Math.max(0, Math.trunc(current.sales));

 for (let i = quartersOldestFirst.length -1; i >=0; i--) {
 const q = quartersOldestFirst[i];
 out[i] = { engineers: engNow, sales: salesNow };

 engNow = Math.max(0, engNow - Math.trunc(Number(q.new_engineers ??0)));
 salesNow = Math.max(0, salesNow - Math.trunc(Number(q.new_sales ??0)));
 }

 return out;
}
