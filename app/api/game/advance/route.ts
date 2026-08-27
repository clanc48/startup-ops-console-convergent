import { NextResponse } from "next/server";
import { supabaseFromCookies } from "@/lib/supabaseServer";
import { computeInsights } from "@/lib/insights";
import { enqueueAiSummaryJob } from "@/lib/jobQueue";
import { requestId, nowMs, logInfo, logError } from "@/lib/observability";
import { validateAdvanceInput } from "@/lib/advanceValidation";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rpcCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    logError("advance.invalid_json", { rid });
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const validated = validateAdvanceInput(body);
  if (!validated.ok) {
    logError("advance.invalid_input", { rid, msg: validated.msg });
    return new NextResponse(validated.msg, { status: 400 });
  }

  const { data: rpcData, error: rpcErr } = await supabase.rpc("advance_game", {
    p_price: validated.input.price,
    p_new_engineers: validated.input.new_engineers,
    p_new_sales: validated.input.new_sales,
    p_salary_pct: validated.input.salary_pct,
  });

  if (rpcErr || !rpcData || !rpcData[0]) {
    const msg = rpcErr?.message ?? "unknown";
    const code = rpcCode(rpcErr);

    // Duplicate submissions and multi-tab races are recoverable: the database is
    // authoritative, so return the current state rather than repeating the mutation.
    if (msg === "CONCURRENT_ADVANCE") {
      logInfo("advance.concurrent_recovered", { rid });

      const { data: game, error: gameErr } = await supabase
        .from("games")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (gameErr || !game) {
        logError("advance.concurrent_load_game_failed", {
          rid,
          error: gameErr?.message ?? "game_not_found",
        });
        return new NextResponse("Unable to recover current state", { status: 500 });
      }

      const runNo = Number(game.run_no ?? 1);
      const { data: quarters, error: qErr } = await supabase
        .from("quarters")
        .select("*")
        .eq("game_id", game.id)
        .eq("run_no", runNo)
        .order("created_at", { ascending: false })
        .limit(20);

      if (qErr) {
        logError("advance.concurrent_load_quarters_failed", { rid, error: qErr.message });
        return new NextResponse("Unable to recover current state", { status: 500 });
      }

      const quartersPlain = (quarters ?? []).map((quarter) => ({ ...quarter }));
      const insights = computeInsights(game, quartersPlain);
      logInfo("advance.done", { rid, ms: nowMs() - t0, recovered: true });
      return NextResponse.json({ game, last_quarters: quartersPlain, insights });
    }

    const status = code === "P0002" ? 404 : code === "P0001" || code === "23505" ? 409 : 500;
    logError("advance.rpc_failed", { rid, error: msg, status, code });

    const clientMessage = status === 404 ? "Game not found" : status === 409 ? "Game state changed; refresh and retry" : "Unable to advance game";
    return new NextResponse(clientMessage, { status });
  }

  const updatedGame = rpcData[0].game;
  const insertedQuarter = rpcData[0].quarter;
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
    return new NextResponse("Unable to load updated history", { status: 500 });
  }

  const quartersPlain = (quarters ?? []).map((quarter) => ({ ...quarter }));

  // Optional AI work is deliberately non-blocking; the authoritative game mutation
  // has already committed and must not fail because a bonus feature is unavailable.
  try {
    await enqueueAiSummaryJob({
      user_id: userId,
      game_id: insertedQuarter.game_id,
      quarter_id: insertedQuarter.id,
    });
    logInfo("advance.job_enqueued", { rid, job: "ai_summary", quarter_id: insertedQuarter.id });
  } catch (error: unknown) {
    logError("advance.job_enqueue_failed", { rid, error: errorMessage(error) });
  }

  const insights = computeInsights(updatedGame, quartersPlain);
  logInfo("advance.done", { rid, ms: nowMs() - t0 });

  return NextResponse.json({ game: updatedGame, last_quarters: quartersPlain, insights });
}
