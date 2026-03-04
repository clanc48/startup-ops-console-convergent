import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requestId, nowMs, logInfo, logError } from "@/lib/observability";
import { generateExecutiveSummary } from "@/lib/aiExecutiveSummary";
import { rateLimit } from "@/lib/rateLimit";

const WORKER_ID = `worker-${process.pid}`;

export async function POST(req: Request) {
  const rid = requestId();
  const t0 = nowMs();

  // ---------------------------------------------------------------------------
  // SECURITY: This endpoint is a demo worker. In production it MUST be protected,
  // otherwise it is an easy cost-amplifier (it can trigger paid AI calls).
  //
  // Policy:
  // - In development: allow unauthenticated calls for demo convenience.
  // - In production: require X-Worker-Token == WORKER_TOKEN and apply rate-limit.
  // ---------------------------------------------------------------------------
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    const token = req.headers.get("x-worker-token") ?? "";
    const expected = process.env.WORKER_TOKEN ?? "";
    if (!expected || token !== expected) {
      logError("worker.unauthorized", { rid });
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const rl = rateLimit(`worker:${token}`, { limit: 10, windowMs: 60_000 });
    if (!rl.ok) {
      logError("worker.rate_limited", { rid, retry_after_ms: rl.retryAfterMs });
      return new NextResponse("Rate limited", {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 0) / 1000)),
        },
      });
    }
  }

  logInfo("worker.start", { rid, worker: WORKER_ID });

  const { data: jobs, error: jErr } = await supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (jErr) {
    logError("worker.select_failed", { rid, error: jErr.message });
    return new NextResponse(jErr.message, { status: 500 });
  }

  const job: any = jobs?.[0];
  if (!job) {
    logInfo("worker.no_jobs", { rid, ms: nowMs() - t0 });
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const { data: locked, error: lockErr } = await supabaseAdmin
    .from("jobs")
    .update({
      status: "running",
      locked_at: new Date().toISOString(),
      locked_by: WORKER_ID,
      attempts: (job.attempts ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  if (lockErr || !locked) {
    logInfo("worker.lock_contended", { rid, job_id: job.id, ms: nowMs() - t0 });
    return NextResponse.json({ ok: true, processed: 0, contended: true });
  }

  logInfo("worker.locked", { rid, job_id: locked.id, type: locked.type });

  try {
    if (locked.type !== "ai_summary") {
      throw new Error(`Unsupported job type: ${locked.type}`);
    }

    const quarterId = locked.quarter_id;
    if (!quarterId) throw new Error("Missing quarter_id on job");

    const { data: quarter, error: qErr } = await supabaseAdmin
      .from("quarters")
      .select("*")
      .eq("id", quarterId)
      .single();

    if (qErr || !quarter) throw new Error(`Failed to load quarter: ${qErr?.message ?? "unknown"}`);

    if (quarter.ai_summary) {
      await supabaseAdmin.from("jobs").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", locked.id);
      logInfo("worker.cached_done", { rid, job_id: locked.id, quarter_id: quarterId, ms: nowMs() - t0 });
      return NextResponse.json({ ok: true, processed: 1, cached: true });
    }

    const gameId = quarter.game_id;
    const { data: game, error: gErr } = await supabaseAdmin
      .from("games")
      .select("*")
      .eq("id", gameId)
      .single();

    if (gErr || !game) throw new Error(`Failed to load game: ${gErr?.message ?? "unknown"}`);

    const { data: last4, error: lErr } = await supabaseAdmin
      .from("quarters")
      .select("*")
      .eq("game_id", gameId)
      .order("created_at", { ascending: false })
      .limit(4);

    if (lErr) throw new Error(`Failed to load last quarters: ${lErr.message}`);

    const last4Plain = (last4 ?? []).map((q: any) => ({ ...q }));

    const summary = await generateExecutiveSummary({
      game,
      quarter,
      lastQuarters: last4Plain,
    });

    const { error: updQErr } = await supabaseAdmin
      .from("quarters")
      .update({ ai_summary: summary })
      .eq("id", quarterId);

    if (updQErr) throw new Error(`Failed to write ai_summary: ${updQErr.message}`);

    await supabaseAdmin
      .from("jobs")
      .update({ status: "done", updated_at: new Date().toISOString(), last_error: null, locked_at: null, locked_by: null })
      .eq("id", locked.id);

    logInfo("worker.done", { rid, job_id: locked.id, quarter_id: quarterId, ms: nowMs() - t0 });
    return NextResponse.json({ ok: true, processed: 1 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    logError("worker.failed", { rid, job_id: locked.id, error: msg });

    const attempts = locked.attempts ?? 1;
    const max = locked.max_attempts ?? 3;
    const terminal = attempts >= max;

    await supabaseAdmin
      .from("jobs")
      .update({
        status: terminal ? "failed" : "queued",
        last_error: msg,
        updated_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
      })
      .eq("id", locked.id);

    return new NextResponse(msg, { status: 500 });
  }
}
