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

  // Atomically (transactionally) append the quarter + advance the game state.
  // IMPORTANT: the simulation itself runs inside the DB function to keep outcomes fully server-authoritative.
  const { data: rpcData, error: rpcErr } = await supabase.rpc("advance_game", {
    p_price: v.input.price,
    p_new_engineers: v.input.new_engineers,
    p_new_sales: v.input.new_sales,
    p_salary_pct: v.input.salary_pct,
  });

  if (rpcErr || !rpcData || !rpcData[0]) {
    const msg = rpcErr?.message ?? "unknown";
    const code = (rpcErr as any)?.code;
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

  const { data: quarters, error: qErr } = await supabase
    .from("quarters")
    .select("*")
    .eq("game_id", insertedQuarter.game_id)
    .order("created_at", { ascending: false })
    .limit(4);

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
