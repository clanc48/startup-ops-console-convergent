import { NextResponse } from "next/server";
import { ENABLE_AI } from "@/lib/envFlags";
import { supabaseFromCookies } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { generateExecutiveSummary } from "@/lib/aiExecutiveSummary";
import { requestId, logInfo, logError } from "@/lib/observability";
import { rateLimit } from "@/lib/rateLimit";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Generate (and cache) an AI executive summary for a quarter.
 *
 * This is an optional portfolio feature. Core simulation behavior does not depend
 * on this route. The endpoint is hidden when AI is disabled.
 */
export async function POST(req: Request) {
  if (!ENABLE_AI) return new NextResponse("Not Found", { status: 404 });

  const rid = requestId();

  if (!process.env.OPENAI_API_KEY) {
    logError("ai.notes.misconfigured", { rid });
    return new NextResponse("AI feature unavailable", { status: 503 });
  }

  const supabase = await supabaseFromCookies();
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user) return new NextResponse("Unauthorized", { status: 401 });

  // Best-effort single-process limiter for this archived sample. A multi-instance
  // production deployment should use a shared store or edge/platform limiter.
  const rl = rateLimit(`ai-notes:${authData.user.id}`, { limit: 5, windowMs: 60_000 });
  if (!rl.ok) {
    logError("ai.notes.rate_limited", { rid, user_id: authData.user.id });
    return new NextResponse("Rate limited", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
    });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // Empty body is allowed; it means "latest quarter".
  }

  const quarterId =
    body && typeof body === "object" && "quarter_id" in body && typeof (body as { quarter_id?: unknown }).quarter_id === "string"
      ? (body as { quarter_id: string }).quarter_id
      : undefined;

  // The user-scoped client is intentionally used for reads so RLS remains part of
  // the authorization boundary even though the final cache write needs service access.
  const { data: game, error: gErr } = await supabase
    .from("games")
    .select("*")
    .eq("user_id", authData.user.id)
    .single();

  if (gErr || !game) return new NextResponse("Game not found", { status: 404 });

  let quarter;
  if (quarterId) {
    const { data, error } = await supabase
      .from("quarters")
      .select("*")
      .eq("id", quarterId)
      .single();
    if (error || !data) return new NextResponse("Quarter not found", { status: 404 });
    quarter = data;
  } else {
    const runNo = Number(game.run_no ?? 1);
    const { data, error } = await supabase
      .from("quarters")
      .select("*")
      .eq("game_id", game.id)
      .eq("run_no", runNo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return new NextResponse("No quarters yet", { status: 404 });
    quarter = data;
  }

  if (quarter.game_id !== game.id) return new NextResponse("Forbidden", { status: 403 });

  if (quarter.ai_summary) {
    logInfo("ai.notes.cached", { rid, quarter_id: quarter.id });
    return NextResponse.json({
      ok: true,
      cached: true,
      ai_summary: quarter.ai_summary,
      quarter_id: quarter.id,
    });
  }

  const runNo = Number(quarter.run_no ?? game.run_no ?? 1);
  const { data: last4, error: lErr } = await supabase
    .from("quarters")
    .select("*")
    .eq("game_id", game.id)
    .eq("run_no", runNo)
    .order("created_at", { ascending: false })
    .limit(4);

  if (lErr) {
    logError("ai.notes.history_failed", { rid, error: lErr.message });
    return new NextResponse("Unable to load summary context", { status: 500 });
  }

  const last4Plain = (last4 ?? []).map((item) => ({ ...item }));

  try {
    const summary = await generateExecutiveSummary({
      game,
      quarter,
      lastQuarters: last4Plain,
    });

    const { error: updErr } = await supabaseAdmin
      .from("quarters")
      .update({ ai_summary: summary })
      .eq("id", quarter.id)
      .eq("game_id", game.id);

    if (updErr) {
      logError("ai.notes.write_failed", { rid, error: updErr.message });
      return new NextResponse("Unable to cache summary", { status: 500 });
    }

    logInfo("ai.notes.generated", { rid, quarter_id: quarter.id });
    return NextResponse.json({
      ok: true,
      cached: false,
      ai_summary: summary,
      quarter_id: quarter.id,
    });
  } catch (error: unknown) {
    logError("ai.notes.failed", { rid, error: errorMessage(error) });
    return new NextResponse("AI summary generation failed", { status: 500 });
  }
}
