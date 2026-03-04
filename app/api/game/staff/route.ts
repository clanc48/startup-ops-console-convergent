import { NextResponse } from "next/server";
import { supabaseFromCookies } from "@/lib/supabaseServer";
import { requestId, logError, logInfo } from "@/lib/observability";

const OFFICE_CAPACITY = 30;

function toNonNegInt(v: any): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

export async function POST(req: Request) {
  const rid = requestId();
  const supabase = await supabaseFromCookies();

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user) {
    logError("staff.unauthorized", { rid });
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const userId = authData.user.id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const remove_engineers = toNonNegInt(body?.remove_engineers);
  const remove_sales = toNonNegInt(body?.remove_sales);
  if (remove_engineers === 0 && remove_sales === 0) {
    return new NextResponse("No changes requested", { status: 400 });
  }

  const { data: game, error: gErr } = await supabase
    .from("games")
    .select("id,engineers,sales_staff,is_over")
    .eq("user_id", userId)
    .maybeSingle();

  if (gErr || !game) {
    logError("staff.load_game_failed", { rid, error: gErr?.message ?? "no_game" });
    return new NextResponse("Game not found", { status: 404 });
  }

  if ((game as any).is_over) {
    return new NextResponse("Game is over", { status: 409 });
  }

  const curEng = Number((game as any).engineers ?? 0);
  const curSales = Number((game as any).sales_staff ?? 0);

  const newEng = Math.max(0, curEng - remove_engineers);
  const newSales = Math.max(0, curSales - remove_sales);

  const nextHeadcount = newEng + newSales;
  if (nextHeadcount > OFFICE_CAPACITY) {
    // Shouldn't happen when only removing, but keep defensive check.
    return new NextResponse("Office capacity exceeded", { status: 400 });
  }

  const { data: updated, error: uErr } = await supabase
    .from("games")
    .update({ engineers: newEng, sales_staff: newSales, updated_at: new Date().toISOString() })
    .eq("id", (game as any).id)
    .select("*")
    .single();

  if (uErr) {
    logError("staff.update_failed", { rid, error: uErr.message });
    return new NextResponse(uErr.message, { status: 500 });
  }

  // Ledger event (authoritative staffing history)
  try {
    await supabase.from("staff_events").insert({
      game_id: (game as any).id,
      run_no: Number((updated as any).run_no ?? 1),
      year: Number((updated as any).year),
      quarter: Number((updated as any).quarter),
      delta_engineers: -remove_engineers,
      delta_sales: -remove_sales,
      reason: "remove",
    });
  } catch (e: any) {
    // Non-critical: snapshot is already updated
    logError("staff.event_insert_failed", { rid, error: e?.message ?? String(e) });
  }

  logInfo("staff.updated", { rid, userId, removed_engineers: remove_engineers, removed_sales: remove_sales });
  return NextResponse.json({ ok: true, game: updated });
}
