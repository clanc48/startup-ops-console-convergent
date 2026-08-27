import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requestId, nowMs, logInfo, logError } from "@/lib/observability";
import { generateExecutiveSummary } from "@/lib/aiExecutiveSummary";
import { rateLimit } from "@/lib/rateLimit";

const WORKER_ID = `worker-${process.pid}`;
const STALE_LOCK_MS = 5 * 60_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: Request) {
  const rid = requestId();
  const t0 = nowMs();

  // This endpoint exists to demonstrate queue mechanics. It is open only in local
  // development. A production-mode clone must provide a worker token.
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
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      });
    }
  }

  logInfo("worker.start", { rid, worker: WORKER_ID });

  // Recover jobs abandoned by a crashed worker. The conditional claim below still
  // arbitrates if more than one worker notices the same recovered job.
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS).toISOString();
  const { error: staleErr } = await supabaseAdmin
    .from("jobs")
    .update({
      status: "queued",
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("locked_at", staleBefore);

  if (staleErr) {
    logError("worker.stale_recovery_failed", { rid, error: staleErr.message });
    return new NextResponse("Worker unavailable", { status: 500 });
  }

  const { data: jobs, error: jErr } = await supabaseAdmin
    .from("jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (jErr) {
    logError("worker.select_failed", { rid, error: jErr.message });
    return new NextResponse("Worker unavailable", { status: 500 });
  }

  const job = jobs?.[0];
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
      attempts: Number(job.attempts ?? 0) + 1,
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
    if (locked.type !== "ai_summary") throw new Error("Unsupported job type");
    if (!locked.user_id || !locked.game_id || !locked.quarter_id) {
      throw new Error("Job is missing ownership references");
    }

    // Defense in depth: this worker uses a service-role client that bypasses RLS.
    // Re-validate the complete ownership chain before performing privileged reads
    // or writes, even though the hardening migration also validates it on enqueue.
    const { data: game, error: gErr } = await supabaseAdmin
      .from("games")
      .select("*")
      .eq("id", locked.game_id)
      .eq("user_id", locked.user_id)
      .single();

    if (gErr || !game) throw new Error("Job ownership validation failed for game");

    const { data: quarter, error: qErr } = await supabaseAdmin
      .from("quarters")
      .select("*")
      .eq("id", locked.quarter_id)
      .eq("game_id", locked.game_id)
      .single();

    if (qErr || !quarter) throw new Error("Job ownership validation failed for quarter");

    if (quarter.ai_summary) {
      await supabaseAdmin
        .from("jobs")
        .update({
          status: "done",
          updated_at: new Date().toISOString(),
          last_error: null,
          locked_at: null,
          locked_by: null,
        })
        .eq("id", locked.id)
        .eq("locked_by", WORKER_ID);

      logInfo("worker.cached_done", {
        rid,
        job_id: locked.id,
        quarter_id: quarter.id,
        ms: nowMs() - t0,
      });
      return NextResponse.json({ ok: true, processed: 1, cached: true });
    }

    const runNo = Number(quarter.run_no ?? 1);
    const { data: last4, error: lErr } = await supabaseAdmin
      .from("quarters")
      .select("*")
      .eq("game_id", locked.game_id)
      .eq("run_no", runNo)
      .order("created_at", { ascending: false })
      .limit(4);

    if (lErr) throw new Error("Failed to load quarter history");

    const last4Plain = (last4 ?? []).map((item) => ({ ...item }));
    const summary = await generateExecutiveSummary({ game, quarter, lastQuarters: last4Plain });

    const { error: updQErr } = await supabaseAdmin
      .from("quarters")
      .update({ ai_summary: summary })
      .eq("id", quarter.id)
      .eq("game_id", locked.game_id);

    if (updQErr) throw new Error("Failed to write AI summary");

    const { error: doneErr } = await supabaseAdmin
      .from("jobs")
      .update({
        status: "done",
        updated_at: new Date().toISOString(),
        last_error: null,
        locked_at: null,
        locked_by: null,
      })
      .eq("id", locked.id)
      .eq("locked_by", WORKER_ID);

    if (doneErr) throw new Error("Failed to finalize job");

    logInfo("worker.done", {
      rid,
      job_id: locked.id,
      quarter_id: quarter.id,
      ms: nowMs() - t0,
    });
    return NextResponse.json({ ok: true, processed: 1 });
  } catch (error: unknown) {
    const msg = errorMessage(error);
    logError("worker.failed", { rid, job_id: locked.id, error: msg });

    const attempts = Number(locked.attempts ?? 1);
    const maxAttempts = Number(locked.max_attempts ?? 3);
    const terminal = attempts >= maxAttempts;

    await supabaseAdmin
      .from("jobs")
      .update({
        status: terminal ? "failed" : "queued",
        last_error: msg.slice(0, 1000),
        updated_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
      })
      .eq("id", locked.id)
      .eq("locked_by", WORKER_ID);

    return new NextResponse("Worker failed", { status: 500 });
  }
}
