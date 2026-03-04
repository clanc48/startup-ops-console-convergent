"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

import { Shell, Layout, Grid, Stack } from "@/components/ui/layout";
import { Topbar } from "@/components/ui/Topbar";
import { Sidebar } from "@/components/ui/Sidebar";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Table } from "@/components/ui/Table";
import VerifiedBadge from "@/components/VerifiedBadge";

type RunSummary = {
 run_no: number;
 is_current: boolean;
 started_at: string | null;
 last_played_at: string | null;
 quarters_count: number;
 cumulative_profit: number;
 quarters: any[];
};

type HistoryPayload = {
 game_id: string;
 current_run_no: number;
 runs: RunSummary[];
};

export default function HistoryPage() {
 const router = useRouter();

 const [authed, setAuthed] = useState<boolean | null>(null);
 const [loading, setLoading] = useState(true);
 const [err, setErr] = useState<string | null>(null);
 const [payload, setPayload] = useState<HistoryPayload | null>(null);

 const [activeRun, setActiveRun] = useState<number | null>(null);

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

 async function load() {
 setErr(null);
 setLoading(true);
 try {
 const res = await fetch("/api/game/history", { cache: "no-store", credentials: "include" });
 if (res.status ===401) {
 router.push("/login");
 return;
 }
 if (!res.ok) throw new Error(await res.text());
 const json = (await res.json()) as HistoryPayload;
 setPayload(json);
 setActiveRun((prev) => prev ?? json.current_run_no);
 } catch (e: any) {
 setErr(e?.message ?? "Failed to load history.");
 } finally {
 setLoading(false);
 }
 }

 useEffect(() => {
 if (authed) load();
 if (authed === false) {
 setLoading(false);
 setPayload(null);
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [authed]);

 const runs = useMemo(() => payload?.runs ?? [], [payload?.runs]);

 const selected = useMemo(() => {
 if (!runs.length) return null;
 const target = activeRun ?? payload?.current_run_no ?? null;
 return runs.find((r) => r.run_no === target) ?? runs[0];
 }, [runs, activeRun, payload?.current_run_no]);

 const financials = useMemo(() => {
 if (!selected?.quarters?.length) return null;
 const q = selected.quarters;
 const total_revenue = q.reduce((acc, r) => acc + Number(r.revenue ??0),0);
 const total_payroll = q.reduce((acc, r) => acc + Number(r.payroll ??0),0);
 const total_net = q.reduce((acc, r) => acc + Number(r.net_income ??0),0);
 const last_cash_end = Number(q[q.length -1]?.cash_end ??0);
 return { total_revenue, total_payroll, total_net, last_cash_end };
 }, [selected]);

 const employment = useMemo(() => {
 if (!selected?.quarters?.length) return null;
 const q = selected.quarters;
 const total_hires_engineers = q.reduce((acc, r) => acc + Number(r.new_engineers ??0),0);
 const total_hires_sales = q.reduce((acc, r) => acc + Number(r.new_sales ??0),0);
 const last_salary_pct = Number(q[q.length -1]?.salary_pct ??0);
 return { total_hires_engineers, total_hires_sales, last_salary_pct };
 }, [selected]);

 return (
 <Shell>
 <Topbar
 title="Startup Ops Console"
 subtitle="History"
 right={
 <>
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
 { label: "Staffing", href: "/staffing" },
 { label: "Operations", href: "/operations" },
 { label: "History", href: "/history", active: true },
 ]}
 footer={
 <div className="ui-muted" style={{ fontSize:12 }}>
 Past runs are separated by run number.
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

 {loading && <Alert>Loading history...</Alert>}

 {!loading && payload && (
 <Grid variant="main">
 <Stack>
 <Panel>
 <Panel.Header title="Runs" subtitle="Select a past run to view its quarter ledger." right={<Badge>Archive</Badge>} />
 <Panel.Body>
 {runs.length ===0 ? (
 <div className="ui-muted">No runs yet. Play a quarter, then reset to create another run.</div>
 ) : (
 <div style={{ display: "flex", gap:8, flexWrap: "wrap" }}>
 {runs.map((r) => (
 <button
 key={r.run_no}
 className={`ui-btn ${r.run_no === (selected?.run_no ?? null) ? "" : "ghost"}`.trim()}
 onClick={() => setActiveRun(r.run_no)}
 style={{ cursor: "pointer" }}
 >
 Run {r.run_no}
 {r.is_current ? " (current)" : ""}
 </button>
 ))}
 </div>
 )}
 </Panel.Body>
 </Panel>

 <Panel>
 <Panel.Header
 title="Run Ledger"
 subtitle={
 selected
 ? `Run ${selected.run_no} - ${selected.quarters_count} quarters - Cumulative profit $${Math.round(selected.cumulative_profit).toLocaleString()}`
 : ""
 }
 right={selected?.is_current ? <Badge tone="good">Current</Badge> : <Badge>Past</Badge>}
 />
 <Panel.Body>
 {!selected ? (
 <div className="ui-muted">No run selected.</div>
 ) : (
 <Table columns={["Period", "Price", "Revenue", "Payroll", "Net", "Cash End", "Quality", "Verification"]}>
 {selected.quarters.length ===0 ? (
 <tr>
 <td colSpan={8} className="ui-muted">
 No quarters in this run.
 </td>
 </tr>
 ) : (
 selected.quarters.map((q: any) => {
 const net = Number(q.net_income);
 return (
 <tr key={q.id}>
 <td>{`Y${q.year} Q${q.quarter}`}</td>
 <td>${Math.round(Number(q.price)).toLocaleString()}</td>
 <td>${Math.round(Number(q.revenue)).toLocaleString()}</td>
 <td>${Math.round(Number(q.payroll)).toLocaleString()}</td>
 <td className={net >=0 ? "ui-pos" : "ui-neg"}>
 {net >=0 ? "+" : ""}${Math.round(net).toLocaleString()}
 </td>
 <td>${Math.round(Number(q.cash_end)).toLocaleString()}</td>
 <td>{q.quality_end}</td>
 <td>
 <VerifiedBadge verified={q.verified} />
 </td>
 </tr>
 );
 })
 )}
 </Table>
 )}
 </Panel.Body>
 </Panel>
 </Stack>

 <Stack>
 <Panel>
 <Panel.Header title="Financials" subtitle="Totals for the selected run" right={<Badge>Summary</Badge>} />
 <Panel.Body>
 {!financials ? (
 <div className="ui-muted">No data yet.</div>
 ) : (
 <Table columns={["Metric", "Value"]}>
 <tr>
 <td>Total Revenue</td>
 <td>${Math.round(financials.total_revenue).toLocaleString()}</td>
 </tr>
 <tr>
 <td>Total Payroll</td>
 <td>${Math.round(financials.total_payroll).toLocaleString()}</td>
 </tr>
 <tr>
 <td>Total Net Income</td>
 <td className={financials.total_net >=0 ? "ui-pos" : "ui-neg"}>
 {financials.total_net >=0 ? "+" : ""}${Math.round(financials.total_net).toLocaleString()}
 </td>
 </tr>
 <tr>
 <td>Ending Cash (last quarter)</td>
 <td>${Math.round(financials.last_cash_end).toLocaleString()}</td>
 </tr>
 </Table>
 )}
 </Panel.Body>
 </Panel>

 <Panel>
 <Panel.Header title="Employment" subtitle="Hiring and salary data for the selected run" right={<Badge>Staffing</Badge>} />
 <Panel.Body>
 {!employment ? (
 <div className="ui-muted">No data yet.</div>
 ) : (
 <Table columns={["Metric", "Value"]}>
 <tr>
 <td>Total Engineer Hires</td>
 <td>{Math.round(employment.total_hires_engineers).toLocaleString()}</td>
 </tr>
 <tr>
 <td>Total Sales Hires</td>
 <td>{Math.round(employment.total_hires_sales).toLocaleString()}</td>
 </tr>
 <tr>
 <td>Last Salary Percent</td>
 <td>{Math.round(employment.last_salary_pct).toLocaleString()}%</td>
 </tr>
 </Table>
 )}
 </Panel.Body>
 </Panel>
 </Stack>
 </Grid>
 )}
 </Layout>
 </Shell>
 );
}
