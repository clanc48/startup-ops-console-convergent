"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import type { GamePayload } from "@/lib/types";

import DecisionForm, { DecisionInput } from "@/components/DecisionForm";
import OfficeGrid from "@/components/OfficeGrid";
import AdvisorPanel from "@/components/AdvisorPanel";
import ExecutiveSummaryPanel from "@/components/ExecutiveSummaryPanel";
import JobControlsPanel from "@/components/JobControlsPanel";
import { useRealtimeQuarters } from "@/components/hooks/useRealtimeQuarters";

import { Shell, Layout, Grid, Stack } from "@/components/ui/layout";
import { Topbar } from "@/components/ui/Topbar";
import { Sidebar } from "@/components/ui/Sidebar";
import { Panel } from "@/components/ui/Panel";
import { KpiCard } from "@/components/ui/KpiCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Table } from "@/components/ui/Table";

export default function GamePage() {
  const router = useRouter();

  // The full "dashboard payload" we fetch from the server.
  // It includes the current game snapshot + the last few quarters + computed insights.
  const [payload, setPayload] = useState<GamePayload | null>(null);

  // Simple UI state flags.
  const [loading, setLoading] = useState(true); // page is loading data
  const [busyAdvance, setBusyAdvance] = useState(false); // user clicked "Advance" and we are waiting for server
  const [busyReset, setBusyReset] = useState(false); // user clicked "Reset Game" and we are wiping data

  // Any error message we want to show at the top of the page.
  const [err, setErr] = useState<string | null>(null);

  // --- Authentication guard (client-side) ---
  // When the page opens, check if the user is signed in.
  // If they are not signed in, send them to the login page.
  const [authed, setAuthed] = useState<boolean | null>(null);

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

  // --- Load the game dashboard from our server ---
  // This calls our Next.js API route (`GET /api/game`) which:
  //1) ensures a game row exists for this user
  //2) loads last quarters
  //3) returns a JSON payload
  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/game", { cache: "no-store", credentials: "include" });
      if (res.status ===401) {
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      setPayload(await res.json());
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load game.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Load once on first render (but only after auth is known).
  useEffect(() => {
    if (authed) load();
    if (authed === false) {
      setLoading(false);
      setPayload(null);
    }
  }, [authed, load]);

  // --- Realtime updates ---
  // If new quarters are inserted/updated in the database (for this game),
  // Supabase Realtime notifies us and we simply reload the dashboard.
  const gameId = payload?.game?.id ?? null;
  useRealtimeQuarters(gameId, () => load());

  // --- "Advance the quarter" button handler ---
  // Takes the user inputs (price/hiring/salary%) and asks the server to compute
  // the next quarter and write the results to the database.
  async function onAdvance(input: DecisionInput) {
    setErr(null);
    setBusyAdvance(true);
    try {
      const res = await fetch("/api/game/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      if (res.status ===401) {
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error(await res.text());

      // Server returns the updated dashboard payload right away.
      setPayload(await res.json());
    } catch (e: any) {
      setErr(e?.message ?? "Advance failed.");
    } finally {
      setBusyAdvance(false);
    }
  }

  // --- Logout button handler ---
  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  // --- Reset button handler ---
  // This is the "wipe the game" button.
  // It deletes the quarter history + queued jobs and resets the snapshot back
  // to the starting state.
  async function resetGame() {
    if (!payload?.game) return;

    const ok = window.confirm(
      "This will archive your current run (keeps history for the History page) and start a new run at Year1 Quarter1. Continue?"
    );
    if (!ok) return;

    setErr(null);
    setBusyReset(true);
    try {
      const res = await fetch("/api/game/reset", { method: "POST", credentials: "include" });
      if (res.status ===401) {
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error(await res.text());

      // After resetting, reload so the UI shows the fresh state.
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Reset failed.");
    } finally {
      setBusyReset(false);
    }
  }

  // Convenience reference (current game snapshot).
  const game = payload?.game;

  // Default price shown in the decision form.
  // If we have history, use the newest quarter price; otherwise use a safe default.
  const defaultPrice = useMemo(() => {
    if (!payload?.last_quarters?.length) return 500_000;
    return Number(payload.last_quarters[0].price);
  }, [payload]);

  // KPIs shown on the dashboard.
  // Using `useMemo` avoids recalculating on every render unless inputs change.
  const kpis = useMemo(() => {
    const q0 = payload?.last_quarters?.[0];
    const cash = game ? Number(game.cash) : 0;
    const revenue = q0 ? Number(q0.revenue) : 0;
    const net = q0 ? Number(q0.net_income) : 0;

    // Payroll comes from the quarter ledger when available; otherwise estimate from headcount.
    const payroll = q0
      ? Math.max(1, Number(q0.payroll))
      : Math.max(1, ((game?.engineers ?? 0) + (game?.sales_staff ?? 0)) * 30_000);

    // "Runway" is how many quarters of payroll we can afford with current cash.
    const runway = cash / payroll;

    return { cash, revenue, net, payroll, runway, quality: game?.quality ?? 0 };
  }, [payload, game]);

  // --- UI ---
  return (
    <Shell>
      {/* Top navigation bar */}
      <Topbar
        title="Startup Ops Console"
        subtitle="Realtime • audited ledger • jobs • AI summary"
        right={
          <>
            {/* Current game status badge */}
            {game && (
              <Badge tone={game.is_over ? "bad" : "good"}>
                Y{game.year} Q{game.quarter} • {game.is_over ? "OVER" : "ACTIVE"}
              </Badge>
            )}

            {/* Reload data from the server */}
            <Button variant="ghost" onClick={load} disabled={loading}>
              Refresh
            </Button>

            {/* Destructive action: archive current run and start a new one */}
            <Button
              variant="ghost"
              onClick={resetGame}
              disabled={loading || busyAdvance || busyReset}
              title="Archive this run and start a new run"
            >
              {busyReset ? "Resetting…" : "Reset Game"}
            </Button>

            {/* Sign out */}
            <Button onClick={logout}>Logout</Button>
          </>
        }
      />

      {/* Page layout with sidebar + main content */}
      <Layout
        sidebar={
          <Sidebar
            items={[
              { label: "Overview", active: true },
              { label: "Financials", href: "/financials" },
              { label: "Staffing", href: "/staffing" },
              { label: "Operations", href: "/operations" },
              { label: "History", href: "/history" },
            ]}
            footer={
              <div className="ui-muted" style={{ fontSize: 12 }}>
                Supabase Realtime + queue worker demo.
              </div>
            }
          />
        }
      >
        {/* Error banner */}
        {err && (
          <Alert tone="bad">
            <b>Error:</b> {err}
          </Alert>
        )}

        {/* Loading banner */}
        {loading && <Alert>Loading dashboard…</Alert>}

        {/* Main dashboard content */}
        {!loading && payload && (
          <>
            {/* End state banner (spec: bankrupt vs win w/ cumulative profit) */}
            {game?.is_over && (
              <Alert tone={game.ended_reason === "won" ? "good" : "bad"}>
                {game.ended_reason === "won" ? (
                  <>
                    <b>You win.</b> You reached Year 10 with positive cash. Cumulative profit: <b>${Math.round(Number(payload.cumulative_profit ?? 0)).toLocaleString()}</b>.
                  </>
                ) : (
                  <>
                    <b>Game over.</b> Your company went bankrupt (cash hit $0 or below).
                  </>
                )}
              </Alert>
            )}

            {/* KPI row */}
            <Grid variant="kpi">
              <KpiCard label="Cash" value={`$${Math.round(kpis.cash).toLocaleString()}`} hint="Current balance" />
              <KpiCard label="Revenue" value={`$${Math.round(kpis.revenue).toLocaleString()}`} hint="Most recent quarter" />
              <KpiCard
                label="Net Income"
                value={`${kpis.net >= 0 ? "+" : ""}$${Math.round(kpis.net).toLocaleString()}`}
                hint="After payroll"
                tone={kpis.net >= 0 ? "good" : "bad"}
              />
              <KpiCard label="Quality" value={`${kpis.quality}/100`} hint="Product health" />
              <KpiCard
                label="Runway"
                value={`${kpis.runway.toFixed(2)} qtrs`}
                hint="Cash ÷ payroll"
                tone={kpis.runway >= 4 ? "good" : kpis.runway >= 2 ? "warn" : "bad"}
              />
            </Grid>

            {/* Main two-column layout */}
            <Grid variant="main">
              {/* Left column: decisions + history + visualization */}
              <Stack>
                <Panel>
                  <Panel.Header
                    title="Quarter Decisions"
                    subtitle="Advance the simulation. Server computes, DB stores, realtime updates subscribers."
                    right={<Badge tone={payload.game.is_over ? "bad" : "good"}>{payload.game.is_over ? "Locked" : "Authoritative"}</Badge>}
                  />
                  <Panel.Body>
                    <DecisionForm
                      // Key forces the form to reset when year/quarter changes.
                      key={`${payload.game.year}-${payload.game.quarter}`}
                      disabled={busyAdvance || payload.game.is_over}
                      defaultPrice={defaultPrice}
                      onSubmit={onAdvance}
                      game={payload.game}
                    />
                    {busyAdvance && <div className="ui-muted" style={{ marginTop: 8 }}>Computing quarter results…</div>}
                  </Panel.Body>
                </Panel>

                <Panel>
                  <Panel.Header title="Performance History" subtitle="Last 4 quarters (newest first)." right={<Badge>Ledger</Badge>} />
                  <Panel.Body>
                    <Table columns={["Period", "Price", "Revenue", "Payroll", "Net", "Cash End", "Quality"]}>
                      {payload.last_quarters.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="ui-muted">No history yet—advance a quarter.</td>
                        </tr>
                      ) : (
                        payload.last_quarters.map((q) => {
                          const net = Number(q.net_income);
                          return (
                            <tr key={q.id}>
                              <td>{`Y${q.year} Q${q.quarter}`}</td>
                              <td>${Math.round(Number(q.price)).toLocaleString()}</td>
                              <td>${Math.round(Number(q.revenue)).toLocaleString()}</td>
                              <td>${Math.round(Number(q.payroll)).toLocaleString()}</td>
                              <td className={net >= 0 ? "ui-pos" : "ui-neg"}>
                                {net >= 0 ? "+" : ""}${Math.round(net).toLocaleString()}
                              </td>
                              <td>${Math.round(Number(q.cash_end)).toLocaleString()}</td>
                              <td>{q.quality_end}</td>
                            </tr>
                          );
                        })
                      )}
                    </Table>
                  </Panel.Body>
                </Panel>

                <Panel>
                  <Panel.Header title="Operations" subtitle="Office seating visualization." right={<Badge>Visualization</Badge>} />
                  <Panel.Body>
                    <OfficeGrid engineers={payload.game.engineers} sales={payload.game.sales_staff} />
                  </Panel.Body>
                </Panel>
              </Stack>

              {/* Right column: worker controls + AI summary + advisor insights */}
              <Stack>
                {/* Lets you run the background worker once (demo queue processing) */}
                <JobControlsPanel onAfterRun={() => load()} />

                {/* Shows the newest quarter's AI executive summary (if generated) */}
                <ExecutiveSummaryPanel newestQuarter={payload.last_quarters?.[0]} />

                {/* Plain-English insights computed server-side (non-AI) */}
                <AdvisorPanel insights={payload.insights ?? []} />
              </Stack>
            </Grid>
          </>
        )}
      </Layout>
    </Shell>
  );
}
