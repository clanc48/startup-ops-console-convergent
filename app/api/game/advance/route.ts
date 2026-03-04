import { NextResponse } from "next/server";
import { supabaseFromCookies } from "@/lib/supabaseServer";
import { verifyQuarterRow } from "@/lib/verifyQuarter";
import { computeInsights } from "@/lib/insights";
import { enqueueAiSummaryJob } from "@/lib/jobQueue";
import { requestId, nowMs, logInfo, logError } from "@/lib/observability";

type SimInput = {
  price: number;
  new_engineers: number;
  new_sales: number;
  salary_pct: number;
};

const OFFICE_CAPACITY = 30;

function isFiniteNumber(n: any): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function validate(body: any): { ok: true; input: SimInput } | { ok: false, msg: string } {
  const { price, new_engineers, new_sales, salary_pct } = body ?? {};
  if (!isFiniteNumber(price) || price < 0) return { ok: false, msg: "Invalid price" };
  if (!isFiniteNumber(new_engineers) || new_engineers < 0) return { ok: false, msg: "Invalid new_engineers" };
  if (!isFiniteNumber(new_sales) || new_sales < 0) return { ok: false, msg: "Invalid new_sales" };
  if (!isFiniteNumber(salary_pct) || salary_pct < 1 || salary_pct > 200) return { ok: false, msg: "Invalid salary_pct (1-200)" };

  return {
    ok: true,
    input: {
      price,
      new_engineers: Math.trunc(new_engineers),
      new_sales: Math.trunc(new_sales),
      salary_pct,
    },
  };
}

export async function POST(req: Request) {
  const rid = requestId();
  const t0 = nowMs();

  const supabase = await supabaseFromCookies();
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user) {
    logError("advance.unauthorized", { rid });
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const userId = authData.user.id;

  logInfo("advance.start", { rid, userId });

  let body: any;
  try {
    body = await req.json();
  } catch {
    logError("advance.invalid_json", { rid });
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const v = validate(body);
  if (!v.ok) {
    logError("advance.invalid_input", { rid, msg: v.msg });
    return new NextResponse(v.msg, { status: 400 });
  }

  // Enforce office seat capacity (server-authoritative).
  const { data: game, error: gameErr } = await supabase
    .from("games")
    .select("engineers,sales_staff")
    .eq("user_id", userId)
    .maybeSingle();

  if (gameErr || !game) {
    logError("advance.capacity_load_game_failed", { rid, error: gameErr?.message ?? "no_game" });
    return new NextResponse("Failed to load game", { status: 500 });
  }

  const current = Number(game.engineers ?? 0) + Number(game.sales_staff ?? 0);
  const next = current + v.input.new_engineers + v.input.new_sales;
  if (next > OFFICE_CAPACITY) {
    const msg = `Office capacity exceeded: ${next}/${OFFICE_CAPACITY}. Remove staff on Staffing page before hiring more.`;
    logError("advance.capacity_exceeded", { rid, current, attempted: next, cap: OFFICE_CAPACITY });
    return new NextResponse(msg, { status: 400 });
  }

  const { data: rpcData, error: rpcErr } = await supabase.rpc("advance_game", {
    p_price: v.input.price,
    p_new_engineers: v.input.new_engineers,
    p_new_sales: v.input.new_sales,
    p_salary_pct: v.input.salary_pct,
  });

  if (rpcErr || !rpcData || !rpcData[0]) {
    const msg = rpcErr?.message ?? "unknown";
    const code = (rpcErr as any)?.code;

    // Graceful recovery: if the DB says we already advanced this period (double-submit,
    // retry, multi-tab), just return the current state so the client can update.
    if (msg === "CONCURRENT_ADVANCE") {
      logInfo("advance.concurrent_recovered", { rid });

      const { data: game, error: gameErr } = await supabase
        .from("games")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (gameErr || !game) {
        logError("advance.concurrent_load_game_failed", { rid, error: gameErr?.message ?? "no_game" });
        return new NextResponse(`Failed to recover: ${gameErr?.message ?? "game_not_found"}`, { status: 500 });
      }

      const runNo = Number((game as any).run_no ?? 1);
      const { data: quarters, error: qErr } = await supabase
        .from("quarters")
        .select("*")
        .eq("game_id", (game as any).id)
        .eq("run_no", runNo)
        .order("created_at", { ascending: false })
        .limit(20);

      if (qErr) {
        logError("advance.concurrent_load_quarters_failed", { rid, error: qErr.message });
        return new NextResponse(`Failed to recover: ${qErr.message}`, { status: 500 });
      }

      const verifiedQuarters = (quarters ?? []).map((q: any) => {
        const row = { ...q };
        row.verified = verifyQuarterRow(row);
        return row;
      });

      const insights = computeInsights(game as any, verifiedQuarters);
      logInfo("advance.done", { rid, ms: nowMs() - t0, recovered: true });
      return NextResponse.json({ game, last_quarters: verifiedQuarters, insights });
    }

    const status =
      code === "P0002" ? 404 :
      code === "P0001" ? 409 :
      code === "23505" ? 409 :
      500;
    logError("advance.rpc_failed", { rid, error: msg, status });
    return new NextResponse(`Failed to advance: ${msg}`, { status });
  }

  const updatedGame = rpcData[0].game;
  const insertedQuarter = rpcData[0].quarter;

  // Record staffing deltas in an events ledger (authoritative totals incl. removals).
  try {
    const de = Number((insertedQuarter as any).new_engineers ??0);
    const ds = Number((insertedQuarter as any).new_sales ??0);
    if ((de |0) !==0 || (ds |0) !==0) {
      await supabase.from("staff_events").insert({
        game_id: insertedQuarter.game_id,
        run_no: Number(insertedQuarter.run_no ?? updatedGame.run_no ??1),
        year: Number(insertedQuarter.year),
        quarter: Number(insertedQuarter.quarter),
        delta_engineers: Math.trunc(de),
        delta_sales: Math.trunc(ds),
        reason: "hire",
      });
    }
  } catch {
    // Non-critical: staffing chart can still fall back to estimate.
  }

  const runNo = Number(insertedQuarter.run_no ?? updatedGame.run_no ?? 1);

  const { data: quarters, error: qErr } = await supabase
    .from("quarters")
    .select("*")
    .eq("game_id", insertedQuarter.game_id)
    .eq("run_no", runNo)
    .order("created_at", { ascending: false })
    .limit(20);

  if (qErr) {
    logError("advance.load_quarters_failed", { rid, error: qErr.message });
    return new NextResponse(`Failed to load quarters: ${qErr.message}`, { status: 500 });
  }

  const verifiedQuarters = (quarters ?? []).map((q: any) => {
    const row = { ...q };
    row.verified = verifyQuarterRow(row);
    return row;
  });

  // Enqueue AI summary job for newest quarter (non-blocking)
  try {
    await enqueueAiSummaryJob({ user_id: userId, game_id: insertedQuarter.game_id, quarter_id: insertedQuarter.id });
    logInfo("advance.job_enqueued", { rid, job: "ai_summary", quarter_id: insertedQuarter.id });
  } catch (e: any) {
    logError("advance.job_enqueue_failed", { rid, error: e?.message ?? String(e) });
  }

  const insights = computeInsights(updatedGame, verifiedQuarters);

  logInfo("advance.done", { rid, ms: nowMs() - t0 });

  return NextResponse.json({ game: updatedGame, last_quarters: verifiedQuarters, insights });
}
