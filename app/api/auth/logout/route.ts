import { NextResponse } from "next/server";
import { supabaseFromCookies } from "@/lib/supabaseServer";
import { requestId, logInfo, logError } from "@/lib/observability";

export async function POST() {
  const rid = requestId();
  const supabase = await supabaseFromCookies();
  const { error } = await supabase.auth.signOut();

  if (error) {
    logError("auth.logout_failed", { rid, error: error.message });
    return new NextResponse("Unable to sign out", { status: 500 });
  }

  logInfo("auth.logout", { rid });
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
