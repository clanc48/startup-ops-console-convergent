"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import type { GamePayload } from "@/lib/types";

import { Shell, Layout, Grid, Stack } from "@/components/ui/layout";
import { Topbar } from "@/components/ui/Topbar";
import { Sidebar } from "@/components/ui/Sidebar";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Table } from "@/components/ui/Table";

function n(v: any) {
 const x = Number(v);
 return Number.isFinite(x) ? x :0;
}

export default function OperationsPage() {
 const router = useRouter();

 const [authed, setAuthed] = useState<boolean | null>(null);
 const [loading, setLoading] = useState(true);
 const [err, setErr] = useState<string | null>(null);
 const [payload, setPayload] = useState<GamePayload | null>(null);

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
 setPayload((await res.json()) as GamePayload);
 } catch (e: any) {
 setErr(e?.message ?? "Failed to load operations.");
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

 const ops = useMemo(() => {
 const newest = quarters[0];
 const prev = quarters[1];

 const quality = n(game?.quality);
 const prevQualityEnd = n(prev?.quality_end);
 const newestQualityEnd = n(newest?.quality_end);

 const demand = n(newest?.demand);
 const units = n(newest?.units);
 const price = n(newest?.price);

 const qualityDelta = newestQualityEnd - prevQualityEnd;
 const impliedDemandPerQuality = quality >0 ? demand / quality :0;

 return {
 quality,
 newestQualityEnd,
 qualityDelta,
 price,
 demand,
 units,
 impliedDemandPerQuality,
 };
 }, [game, quarters]);

 const qualityTrend = useMemo(() => {
 return quarters
 .slice()
 .reverse()
 .map((q: any) => ({
 period: `Y${q.year} Q${q.quarter}`,
 quality_end: n(q.quality_end),
 price: n(q.price),
 demand: n(q.demand),
 units: n(q.units),
 }));
 }, [quarters]);

 return (
 <Shell>
 <Topbar
 title="Startup Ops Console"
 subtitle="Operations"
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
 sidebar={
 <Sidebar
 items={[
 { label: "Overview", href: "/game" },
 { label: "Financials", href: "/financials" },
 { label: "Staffing", href: "/staffing" },
 { label: "Operations", href: "/operations", active: true },
 { label: "History", href: "/history" },
 ]}
 footer={
 <div className="ui-muted" style={{ fontSize:12 }}>
 Operations focuses on quality, pricing, and demand.
 </div>
 }
 />
 }
 >
 {err && (
 <Alert tone="bad">
 <b>Error:</b> {err}
 </Alert>
 )}

 {loading && <Alert>Loading operations...</Alert>}

 {!loading && payload && game && (
 <Grid variant="main">
 <Stack>
 <Panel>
 <Panel.Header title="Quality and Demand" subtitle="Latest quarter" right={<Badge>Ops</Badge>} />
 <Panel.Body>
 <Table columns={["Metric", "Value"]}>
 <tr><td>Current quality (snapshot)</td><td>{Math.round(ops.quality).toLocaleString()}/100</td></tr>
 <tr><td>Quality end (latest quarter)</td><td>{Math.round(ops.newestQualityEnd).toLocaleString()}/100</td></tr>
 <tr><td>Quality change vs prior</td><td className={ops.qualityDelta >=0 ? "ui-pos" : "ui-neg"}>{ops.qualityDelta >=0 ? "+" : ""}{Math.round(ops.qualityDelta).toLocaleString()}</td></tr>
 <tr><td>Price (latest quarter)</td><td>${Math.round(ops.price).toLocaleString()}</td></tr>
 <tr><td>Demand (latest quarter)</td><td>{Math.round(ops.demand).toLocaleString()}</td></tr>
 <tr><td>Units sold (latest quarter)</td><td>{Math.round(ops.units).toLocaleString()}</td></tr>
 </Table>
 </Panel.Body>
 </Panel>

 <Panel>
 <Panel.Header title="Operational Trend" subtitle="Quality, price, demand over time" right={<Badge>Ledger</Badge>} />
 <Panel.Body>
 <Table columns={["Period", "Quality End", "Price", "Demand", "Units"]}>
 {qualityTrend.length ===0 ? (
 <tr><td colSpan={5} className="ui-muted">No quarters yet - advance a quarter.</td></tr>
 ) : (
 qualityTrend.map((r) => (
 <tr key={r.period}>
 <td>{r.period}</td>
 <td>{Math.round(r.quality_end).toLocaleString()}</td>
 <td>${Math.round(r.price).toLocaleString()}</td>
 <td>{Math.round(r.demand).toLocaleString()}</td>
 <td>{Math.round(r.units).toLocaleString()}</td>
 </tr>
 ))
 )}
 </Table>
 </Panel.Body>
 </Panel>
 </Stack>

 <Stack>
 <Panel>
 <Panel.Header title="Notes" subtitle="What this means" right={<Badge>Notes</Badge>} />
 <Panel.Body>
 <div className="ui-muted" style={{ fontSize:13, lineHeight:1.5 }}>
 Operations in this sim is primarily the tradeoff between price and quality. Engineers tend to improve quality while sales can reduce it.
 Demand depends on (quality - price), so track how price changes affect demand and units.
 </div>
 </Panel.Body>
 </Panel>
 </Stack>
 </Grid>
 )}
 </Layout>
 </Shell>
 );
}
