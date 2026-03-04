"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { upsampleDailyWithJitter } from "@/lib/jitter";
import type { GamePayload } from "@/lib/types";
import { computeStaffTotalsByEvents, computeStaffTotalsByQuarterEstimate, type StaffEventRow } from "@/lib/staffing";

import { Shell, Layout, Grid, Stack } from "@/components/ui/layout";
import { Topbar } from "@/components/ui/Topbar";
import { Sidebar } from "@/components/ui/Sidebar";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Table } from "@/components/ui/Table";
import { MultiLineChart } from "@/components/ui/MultiLineChart";

function n(v: any) {
 const x = Number(v);
 return Number.isFinite(x) ? x :0;
}

const OFFICE_CAPACITY =30;

function clampInt(n0: number, min: number, max: number) {
 if (!Number.isFinite(n0)) return min;
 return Math.max(min, Math.min(max, Math.trunc(n0)));
}

export default function StaffingPage() {
 const router = useRouter();

 const [authed, setAuthed] = useState<boolean | null>(null);
 const [loading, setLoading] = useState(true);
 const [err, setErr] = useState<string | null>(null);
 const [payload, setPayload] = useState<GamePayload | null>(null);
 const [staffEvents, setStaffEvents] = useState<StaffEventRow[]>([]);

 const [busyManage, setBusyManage] = useState(false);
 const [removeEng, setRemoveEng] = useState<number>(0);
 const [removeSales, setRemoveSales] = useState<number>(0);

 useEffect(() => {
 let mounted = true;
 (async () => {
 const { data } = await supabase.auth.getSession();
 if (!mounted) return;
 setAuthed(Boolean(data.session));
 if (!data.session) router.push("/login");
 })();

 const {
 data: { subscription },
 } = supabase.auth.onAuthStateChange((_event, session) => {
 if (!mounted) return;
 setAuthed(Boolean(session));
 if (!session) router.push("/login");
 });

 return () => {
 mounted = false;
 subscription.unsubscribe();
 };
 }, [router]);

 const load = useCallback(async () => {
 setErr(null);
 setLoading(true);
 try {
 const res = await fetch("/api/game?limit=20", { cache: "no-store", credentials: "include" });
 if (res.status ===401) {
 router.push("/login");
 return;
 }
 if (!res.ok) throw new Error(await res.text());
 const json = (await res.json()) as GamePayload;
 setPayload(json);

 // Best-effort: load staffing deltas ledger to make headcount totals authoritative.
 try {
 const evRes = await fetch("/api/game/staff-events?limit=200", { cache: "no-store", credentials: "include" });
 if (evRes.ok) setStaffEvents((await evRes.json()) as StaffEventRow[]);
 } catch {
 // ignore
 }
 } catch (e: any) {
 setErr(e?.message ?? "Failed to load staffing.");
 } finally {
 setLoading(false);
 }
 }, [router]);

 useEffect(() => {
 if (authed) load();
 if (authed === false) {
 setLoading(false);
 setPayload(null);
 }
 }, [authed, load]);

 const game = payload?.game;
 const quarters = useMemo(() => payload?.last_quarters ?? [], [payload?.last_quarters]);

 const currentHeadcount = n(game?.engineers) + n(game?.sales_staff);
 const seatsRemaining = Math.max(0, OFFICE_CAPACITY - currentHeadcount);

 const metrics = useMemo(() => {
 const engineers = n(game?.engineers);
 const sales = n(game?.sales_staff);
 const headcount = engineers + sales;
 const newest: any = quarters[0];

 const payroll = n(newest?.payroll) || Math.max(1, headcount *30_000);
 const payrollPerHead = headcount >0 ? payroll / headcount :0;

 const units = n(newest?.units);
 const unitsPerSales = sales >0 ? units / sales :0;

 const hiredEng = n(newest?.new_engineers);
 const hiredSales = n(newest?.new_sales);
 const lastSalaryPct = n(newest?.salary_pct);

 const qBalance = n(game?.quality) - (engineers -2 * sales);

 return {
 engineers,
 sales,
 headcount,
 payroll,
 payrollPerHead,
 unitsPerSales,
 hiredEng,
 hiredSales,
 lastSalaryPct,
 quality: n(game?.quality),
 qBalance,
 };
 }, [game, quarters]);

 const hiringTotals = useMemo(() => {
 const hiresEng = quarters.reduce((acc, q: any) => acc + n(q.new_engineers),0);
 const hiresSales = quarters.reduce((acc, q: any) => acc + n(q.new_sales),0);
 return { hiresEng, hiresSales, total: hiresEng + hiresSales };
 }, [quarters]);

 const trendRows = useMemo(() => {
 return quarters
 .slice()
 .reverse()
 .map((q: any) => ({
 period: `Y${q.year} Q${q.quarter}`,
 new_engineers: n(q.new_engineers),
 new_sales: n(q.new_sales),
 salary_pct: n(q.salary_pct),
 payroll: n(q.payroll),
 units: n(q.units),
 }));
 }, [quarters]);

 async function applyStaffChanges() {
 if (!game) return;
 const curEng = n(game.engineers);
 const curSales = n(game.sales_staff);
 const re = clampInt(removeEng,0, curEng);
 const rs = clampInt(removeSales,0, curSales);
 if (re ===0 && rs ===0) {
 setErr("Choose at least one staff member to remove.");
 return;
 }

 const ok = window.confirm(
 `This will remove ${re} engineer(s) and ${rs} sales staff from the current snapshot. Continue?`
 );
 if (!ok) return;

 setBusyManage(true);
 setErr(null);
 try {
 const res = await fetch("/api/game/staff", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 credentials: "include",
 body: JSON.stringify({ remove_engineers: re, remove_sales: rs }),
 });
 if (res.status ===401) {
 router.push("/login");
 return;
 }
 if (!res.ok) throw new Error(await res.text());

 // Reload so KPIs + seat capacity update.
 setRemoveEng(0);
 setRemoveSales(0);
 await load();
 } catch (e: any) {
 setErr(e?.message ?? "Failed to update staff.");
 } finally {
 setBusyManage(false);
 }
 }

 return (
 <Shell>
 <Topbar
 title="Startup Ops Console"
 subtitle="Staffing"
 right={
 <>
 {game && (
 <Badge tone={game.is_over ? "bad" : "good"}>
 Y{game.year} Q{game.quarter} • {game.is_over ? "OVER" : "ACTIVE"}
 </Badge>
 )}
 <Button variant="ghost" onClick={load} disabled={loading}>
 Refresh
 </Button>
 <Button onClick={() => router.push("/game")}>Back to Game</Button>
 </>
 }
 />

 <Layout
 sidebar={(ctx: { open: boolean; toggle: () => void }) => (
 <Sidebar
 items={[
 { label: "Overview", href: "/game" },
 { label: "Financials", href: "/financials" },
 { label: "Staffing", href: "/staffing", active: true },
 { label: "Operations", href: "/operations" },
 { label: "History", href: "/history" },
 ]}
 footer={
 <div className="ui-muted" style={{ fontSize:12 }}>
 Headcount comes from the game snapshot; hiring and salary percent come from the ledger.
 </div>
 }
 >
 <div className="ui-sidebarToggleRow" style={{ marginTop:14 }}>
 <button className="ui-btn ghost" onClick={ctx.toggle} aria-label="Collapse sidebar">
 Hide menu
 </button>
 </div>
 </Sidebar>
 )}
 >
 {err && (
 <Alert tone="bad">
 <b>Error:</b> {err}
 </Alert>
 )}

 {loading && <Alert>Loading staffing...</Alert>}

 {!loading && payload && game && (
 <Stack>
 <Grid variant="alt">
 <Panel>
 <Panel.Header title="Staff Management" subtitle="Remove staff to free office seats (cap:30)." right={<Badge>Actions</Badge>} />
 <Panel.Body>
 <div className="ui-muted" style={{ fontSize:12, marginBottom:10 }}>
 Seats: <b>{currentHeadcount}</b> / <b>{OFFICE_CAPACITY}</b> • Remaining: <b>{seatsRemaining}</b>
 </div>

 <Table columns={["Staffing", "Value"]}>
 <tr>
 <td>Engineers</td>
 <td><b>{Math.round(n(game.engineers)).toLocaleString()}</b></td>
 </tr>
 <tr>
 <td>Sales</td>
 <td><b>{Math.round(n(game.sales_staff)).toLocaleString()}</b></td>
 </tr>
 <tr>
 <td>Blend (E/S)</td>
 <td>
 {(() => {
 const e = n(game.engineers);
 const s = n(game.sales_staff);
 const total = Math.max(1, e + s);
 const ePct = (e / total) *100;
 const sPct = (s / total) *100;
 return (
 <span>
 <b>{ePct.toFixed(0)}%</b> eng / <b>{sPct.toFixed(0)}%</b> sales
 </span>
 );
 })()}
 </td>
 </tr>
 <tr>
 <td>Seniorities (illustrative)</td>
 <td>
 {(() => {
 // We don't store explicit staff seniority in schema, so derive a simple mix
 // from the current game year as a UX hint.
 const e = n(game.engineers);
 const s = n(game.sales_staff);
 const total = e + s;
 const year = n(game.year);
 const srShare = Math.min(0.6, Math.max(0.1, (year -1) *0.07));
 const seniors = Math.round(total * srShare);
 const juniors = Math.max(0, total - seniors);
 return (
 <span>
 <b>{seniors}</b> senior · <b>{juniors}</b> junior
 </span>
 );
 })()}
 </td>
 </tr>
 </Table>

 <div style={{ height:12 }} />

 <div style={{ display: "grid", gap:10, maxWidth:360 }}>
 <label>
 Remove engineers
 <input
 type="number"
 min={0}
 max={n(game.engineers)}
 step={1}
 disabled={busyManage || game.is_over}
 value={removeEng}
 onChange={(e) => setRemoveEng(clampInt(Number(e.target.value),0, n(game.engineers)))}
 />
 </label>

 <label>
 Remove sales
 <input
 type="number"
 min={0}
 max={n(game.sales_staff)}
 step={1}
 disabled={busyManage || game.is_over}
 value={removeSales}
 onChange={(e) => setRemoveSales(clampInt(Number(e.target.value),0, n(game.sales_staff)))}
 />
 </label>

 <Button onClick={applyStaffChanges} disabled={busyManage || game.is_over}>
 {busyManage ? "Updating…" : "Apply Changes"}
 </Button>

 <div className="ui-muted" style={{ fontSize:12, lineHeight:1.5 }}>
 This updates the current snapshot only (the quarters ledger remains append-only).
 </div>
 </div>
 </Panel.Body>
 </Panel>
 </Grid>

 {/* Row1: Staffing trend (full width) */}
 <Grid variant="alt">
 <Panel>
 <Panel.Header title="Staffing Trend" subtitle="Daily trend (jittered)" right={null} />
 <Panel.Body>
 <MultiLineChart
 title="Staffing and payroll"
 subtitle="Payroll, headcount, and units (older → newer)"
 mode="shared-log"
 series={(() => {
 const ordered = (quarters ?? []).slice().reverse();
 const seedBase = Number(game?.id?.toString?.().split("").reduce((a: number, c: string) => (a + c.charCodeAt(0)) |0,0) ??12345);
 const daysPerPeriod =90;

 const payroll = ordered.map((q: any) => n(q.payroll));
 const units = ordered.map((q: any) => n(q.units));

 // Derive staff totals per quarter.
 //
 // Prefer authoritative reconstruction from the staffing events ledger (includes removals).
 // Fallback to an estimate based on quarters if events are missing.
 const totalsByQuarter: { engineers: number; sales: number }[] = (() => {
 if (staffEvents.length >0) {
 // Need a starting point: derive starting snapshot by subtracting all deltas from current.
 const deltaE = staffEvents.reduce((acc, ev) => acc + Number(ev.delta_engineers ??0),0);
 const deltaS = staffEvents.reduce((acc, ev) => acc + Number(ev.delta_sales ??0),0);
 const start = {
 engineers: Math.max(0, n(game?.engineers) - deltaE),
 sales: Math.max(0, n(game?.sales_staff) - deltaS),
 };
 return computeStaffTotalsByEvents({ eventsOldestFirst: staffEvents, start });
 }

 return computeStaffTotalsByQuarterEstimate({
 quartersOldestFirst: ordered as any,
 current: { engineers: n(game?.engineers), sales: n(game?.sales_staff) },
 });
 })();

 const engTotals = totalsByQuarter.map((t) => t.engineers);
 const salesTotals = totalsByQuarter.map((t) => t.sales);

 return [
 { key: "payroll", label: "Payroll", values: upsampleDailyWithJitter(payroll, { seed: seedBase +11, daysPerPeriod, volatility:0.008, smoothness:0.92, meanReversion:0.8, weeklySeasonality:0.1 }), color: "#f59e0b" },
 { key: "eng_total", label: "Engineers", values: upsampleDailyWithJitter(engTotals, { seed: seedBase +12, daysPerPeriod, volatility:0.01, smoothness:0.9, meanReversion:0.7, weeklySeasonality:0.05 }), color: "#7c3aed" },
 { key: "sales_total", label: "Sales", values: upsampleDailyWithJitter(salesTotals, { seed: seedBase +13, daysPerPeriod, volatility:0.01, smoothness:0.9, meanReversion:0.7, weeklySeasonality:0.05 }), color: "#22c55e" },
 { key: "units", label: "Units", values: upsampleDailyWithJitter(units, { seed: seedBase +14, daysPerPeriod, volatility:0.02, smoothness:0.85, meanReversion:0.6, weeklySeasonality:0.25 }), color: "#0ea5e9" },
 ];
 })()}
 />
 </Panel.Body>
 </Panel>
 </Grid>

 {/* Row2: Notes (full width) */}
 <Grid variant="alt">
 <Panel>
 <Panel.Header title="Notes" subtitle="How to interpret staffing" right={null} />
 <Panel.Body>
 <div className="ui-muted" style={{ fontSize:13, lineHeight:1.5 }}>
 Monitor whether payroll and headcount are rising faster than output. A sustained drop in units per sales or a worsening quality balance can indicate an unhealthy mix.
 </div>
 </Panel.Body>
 </Panel>
 </Grid>

 {/* Row3: Run Summary (full width) */}
 <Grid variant="alt">
 <Panel>
 <Panel.Header title="Run Summary (visible quarters)" subtitle="Totals based on quarters currently loaded" right={<Badge>Summary</Badge>} />
 <Panel.Body>
 <Table columns={["Metric", "Value"]}>
 <tr><td>Total engineer hires</td><td>{Math.round(hiringTotals.hiresEng).toLocaleString()}</td></tr>
 <tr><td>Total sales hires</td><td>{Math.round(hiringTotals.hiresSales).toLocaleString()}</td></tr>
 <tr><td>Total hires</td><td>{Math.round(hiringTotals.total).toLocaleString()}</td></tr>
 </Table>
 </Panel.Body>
 </Panel>
 </Grid>

 {/* Row4: Key Metrics (70%) + Recent Trend (30%) */}
 <Grid variant="split7030">
 <Panel>
 <Panel.Header title="Key Metrics" subtitle="Latest quarter" right={<Badge>KPIs</Badge>} />
 <Panel.Body>
 <Table columns={["Metric", "Value"]}>
 <tr><td>Engineers</td><td>{Math.round(metrics.engineers).toLocaleString()}</td></tr>
 <tr><td>Sales</td><td>{Math.round(metrics.sales).toLocaleString()}</td></tr>
 <tr><td>Total headcount</td><td>{Math.round(metrics.headcount).toLocaleString()}</td></tr>
 <tr><td>Payroll (latest qtr)</td><td>${Math.round(metrics.payroll).toLocaleString()}</td></tr>
 <tr><td>Payroll per head</td><td>${Math.round(metrics.payrollPerHead).toLocaleString()}</td></tr>
 <tr><td>Units per sales staff</td><td>{metrics.unitsPerSales.toFixed(1)}</td></tr>
 <tr><td>Quality</td><td>{Math.round(metrics.quality).toLocaleString()}/100</td></tr>
 <tr><td>Quality balance</td><td className={metrics.qBalance >=0 ? "ui-pos" : "ui-neg"}>{metrics.qBalance.toFixed(1)}</td></tr>
 </Table>
 </Panel.Body>
 </Panel>

 <Panel>
 <Panel.Header title="Recent Trend" subtitle="Quarter ledger" right={<Badge>Ledger</Badge>} />
 <Panel.Body>
 <Table columns={["Period", "New Eng", "New Sales", "Salary %", "Payroll", "Units"]}>
 {trendRows.length ===0 ? (
 <tr><td colSpan={6} className="ui-muted">No quarters yet - advance a quarter.</td></tr>
 ) : (
 trendRows.map((r) => (
 <tr key={r.period}>
 <td>{r.period}</td>
 <td>{Math.round(r.new_engineers).toLocaleString()}</td>
 <td>{Math.round(r.new_sales).toLocaleString()}</td>
 <td>{Math.round(r.salary_pct).toLocaleString()}%</td>
 <td>${Math.round(r.payroll).toLocaleString()}</td>
 <td>{Math.round(r.units).toLocaleString()}</td>
 </tr>
 ))
 )}
 </Table>
 </Panel.Body>
 </Panel>
 </Grid>

 </Stack>
 )}
 </Layout>
 </Shell>
 );
}
