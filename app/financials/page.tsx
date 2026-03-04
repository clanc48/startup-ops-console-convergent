"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import type { GamePayload } from "@/lib/types";
import { upsampleDailyWithJitter } from "@/lib/jitter";

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
    return Number.isFinite(x) ? x : 0;
}

export default function FinancialsPage() {
    const router = useRouter();

    const [authed, setAuthed] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [payload, setPayload] = useState<GamePayload | null>(null);
    const [notesLoading, setNotesLoading] = useState(false);

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
            const res = await fetch("/api/game?limit=20", {
                cache: "no-store",
                credentials: "include",
            });
            if (res.status === 401) {
                router.push("/login");
                return;
            }
            if (!res.ok) throw new Error(await res.text());
            setPayload((await res.json()) as GamePayload);
        } catch (e: any) {
            setErr(e?.message ?? "Failed to load financials.");
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

    const metrics = useMemo(() => {
        const newest: any = quarters[0];
        const prev: any = quarters[1];

        const cash = n(game?.cash);
        const revenue = n(newest?.revenue);
        const prevRevenue = n(prev?.revenue);
        const payroll =
            n(newest?.payroll) ||
            Math.max(1, ((game?.engineers ?? 0) + (game?.sales_staff ?? 0)) * 30_000);
        const net = n(newest?.net_income);
        const runway = payroll > 0 ? cash / payroll : 0;

        return {
            cash,
            revenue,
            payroll,
            net,
            runway,
            dRevenue: revenue - prevRevenue,
            margin: revenue > 0 ? net / revenue : 0,
        };
    }, [quarters, game]);

    const trendRows = useMemo(() => {
        return quarters
            .slice()
            .reverse()
            .map((q: any) => ({
                period: `Y${q.year} Q${q.quarter}`,
                price: n(q.price),
                revenue: n(q.revenue),
                payroll: n(q.payroll),
                net: n(q.net_income),
                cash_end: n(q.cash_end),
            }));
    }, [quarters]);

    const series = useMemo(() => {
        // quarters are newest-first; chart wants oldest-first
        const ordered = quarters.slice().reverse();
        return {
            periods: ordered.map((q: any) => `Y${q.year} Q${q.quarter}`),
            revenue: ordered.map((q: any) => n(q.revenue)),
            net: ordered.map((q: any) => n(q.net_income)),
            cashEnd: ordered.map((q: any) => n(q.cash_end)),
        };
    }, [quarters]);

    const dailySeries = useMemo(() => {
        const ordered = quarters.slice().reverse();
        const baseRevenue = ordered.map((q: any) => n(q.revenue));
        const baseNet = ordered.map((q: any) => n(q.net_income));
        const baseCash = ordered.map((q: any) => n(q.cash_end));
        const basePayroll = ordered.map((q: any) => n(q.payroll));

        // stable per-run seed so chart doesn't change on every render
        const seedBase = Number(game?.id?.toString?.().split("").reduce((a: number, c: string) => (a + c.charCodeAt(0)) |0,0) ??12345);

        const daysPerPeriod =90;
        return {
            daysPerPeriod,
            revenue: upsampleDailyWithJitter(baseRevenue, {
                seed: seedBase +1,
                daysPerPeriod,
                volatility:0.02,
                smoothness:0.85,
                meanReversion:0.6,
                weeklySeasonality:0.35,
            }),
            net: upsampleDailyWithJitter(baseNet, {
                seed: seedBase +2,
                daysPerPeriod,
                volatility:0.05,
                smoothness:0.75,
                meanReversion:0.7,
                weeklySeasonality:0.25,
            }),
            cashEnd: upsampleDailyWithJitter(baseCash, {
                seed: seedBase +3,
                daysPerPeriod,
                volatility:0.01,
                smoothness:0.9,
                meanReversion:0.55,
                weeklySeasonality:0.2,
            }),
            payroll: upsampleDailyWithJitter(basePayroll, {
                seed: seedBase +4,
                daysPerPeriod,
                volatility:0.008,
                smoothness:0.92,
                meanReversion:0.8,
                weeklySeasonality:0.1,
            }),
        };
    }, [quarters, game?.id]);

    const recentTrendTbody = useMemo(() => {
        if (trendRows.length === 0) {
            return (
                <tr>
                    <td colSpan={6} className="ui-muted">
                        No quarters yet - advance a quarter.
                    </td>
                </tr>
            );
        }
        return (
            <>
                {trendRows.map((r) => (
                    <tr key={r.period}>
                        <td>{r.period}</td>
                        <td>${Math.round(r.price).toLocaleString()}</td>
                        <td>${Math.round(r.revenue).toLocaleString()}</td>
                        <td>${Math.round(r.payroll).toLocaleString()}</td>
                        <td className={r.net >= 0 ? "ui-pos" : "ui-neg"}>
                            {r.net >= 0 ? "+" : ""}
                            ${Math.round(r.net).toLocaleString()}
                        </td>
                        <td>${Math.round(r.cash_end).toLocaleString()}</td>
                    </tr>
                ))}
            </>
        );
    }, [trendRows]);

    const newestQuarter: any = quarters[0];
    const notes = newestQuarter?.ai_summary as string | null | undefined;

    // Try to populate notes once per quarter by calling the AI notes route if summary is missing.
    useEffect(() => {
        if (!authed) return;
        if (loading) return;
        if (!payload || !game) return;
        if (!newestQuarter) return;
        if (notes) return;
        if (notesLoading) return;

        let cancelled = false;
        (async () => {
            try {
                setNotesLoading(true);
                const res = await fetch("/api/ai/notes", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ quarter_id: newestQuarter.id }),
                });
                // If AI is not configured, don't loop.
                if (!res.ok) return;
                if (!cancelled) await load();
            } finally {
                if (!cancelled) setNotesLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [authed, loading, payload, game, newestQuarter, notes, notesLoading, load]);

    return (
        <Shell>
            <Topbar
                title="Startup Ops Console"
                subtitle="Financials"
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
                            { label: "Financials", href: "/financials", active: true },
                            { label: "Staffing", href: "/staffing" },
                            { label: "Operations", href: "/operations" },
                            { label: "History", href: "/history" },
                        ]}
                        footer={
                            <div className="ui-muted" style={{ fontSize: 12 }}>
                                Financial metrics are derived from the quarter ledger.
                            </div>
                        }
                    >
                        <div className="ui-sidebarToggleRow" style={{ marginTop: 14 }}>
                            <button
                                className="ui-btn ghost"
                                onClick={ctx.toggle}
                                aria-label="Collapse sidebar"
                            >
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

                {loading && <Alert>Loading financials...</Alert>}

                {!loading && payload && game && (
                    <Stack>
                        {/* Row1: Performance (full width) */}
                        <Grid variant="alt">
                            <Panel>
                                <Panel.Header title="Performance" subtitle="Run metrics over time" right={null} />
                                <Panel.Body>
                                    <MultiLineChart
                                        title="Run performance"
                                        subtitle="Daily trend (with realistic jitter + weekly seasonality)"
                                        mode="shared-log"
                                        series={[
                                            { key: "revenue", label: "Revenue", values: dailySeries.revenue, color: "#7c3aed" },
                                            { key: "net", label: "Net", values: dailySeries.net, color: "#22c55e" },
                                            { key: "cash", label: "Cash", values: dailySeries.cashEnd, color: "#0ea5e9" },
                                            { key: "payroll", label: "Payroll", values: dailySeries.payroll, color: "#f59e0b" },
                                        ]}
                                        xLabels={series.periods}
                                    />
                                </Panel.Body>
                            </Panel>
                        </Grid>

                        {/* Row2: Notes (full width) */}
                        <Grid variant="alt">
                            <Panel>
                                <Panel.Header
                                    title="Notes"
                                    subtitle={
                                        newestQuarter
                                            ? `Executive summary for Y${newestQuarter.year} Q${newestQuarter.quarter}`
                                            : "Executive summary"
                                    }
                                    right={<Badge>AI</Badge>}
                                />
                                <Panel.Body>
                                    <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                                        {notes ? (
                                            <div>{notes}</div>
                                        ) : notesLoading ? (
                                            <div className="ui-muted">Generating notes…</div>
                                        ) : (
                                            <div className="ui-muted">
                                                No notes yet. Advance a quarter to generate an executive summary.
                                            </div>
                                        )}
                                    </div>
                                </Panel.Body>
                            </Panel>
                        </Grid>

                        {/* Row3: Key Metrics (70%) + Recent Trend (30%) */}
                        <Grid variant="split7030">
                            <Panel>
                                <Panel.Header title="Key Metrics" subtitle="Latest quarter" right={<Badge>KPIs</Badge>} />
                                <Panel.Body>
                                    <Table columns={["Metric", "Value"]}>
                                        <tr>
                                            <td>Cash</td>
                                            <td>${Math.round(metrics.cash).toLocaleString()}</td>
                                        </tr>
                                        <tr>
                                            <td>Revenue (latest qtr)</td>
                                            <td>${Math.round(metrics.revenue).toLocaleString()}</td>
                                        </tr>
                                        <tr>
                                            <td>Revenue change vs prior</td>
                                            <td className={metrics.dRevenue >= 0 ? "ui-pos" : "ui-neg"}>
                                                {metrics.dRevenue >= 0 ? "+" : ""}
                                                ${Math.round(metrics.dRevenue).toLocaleString()}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>Payroll (latest qtr)</td>
                                            <td>${Math.round(metrics.payroll).toLocaleString()}</td>
                                        </tr>
                                        <tr>
                                            <td>Net income (latest qtr)</td>
                                            <td className={metrics.net >= 0 ? "ui-pos" : "ui-neg"}>
                                                {metrics.net >= 0 ? "+" : ""}
                                                ${Math.round(metrics.net).toLocaleString()}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>Margin (latest qtr)</td>
                                            <td className={metrics.margin >= 0 ? "ui-pos" : "ui-neg"}>
                                                {(metrics.margin * 100).toFixed(1)}%
                                            </td>
                                        </tr>
                                        <tr>
                                            <td>Runway (cash / payroll)</td>
                                            <td>{metrics.runway.toFixed(2)} quarters</td>
                                        </tr>
                                    </Table>
                                </Panel.Body>
                            </Panel>

                            <Panel>
                                <Panel.Header title="Recent Trend" subtitle="Ledger (current run)" right={<Badge>Ledger</Badge>} />
                                <Panel.Body>
                                    <Table columns={["Period", "Price", "Revenue", "Payroll", "Net", "Cash End"]}>
                                        {recentTrendTbody}
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
