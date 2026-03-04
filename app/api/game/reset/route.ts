import { NextResponse } from "next/server";
import { supabaseFromCookies } from "@/lib/supabaseServer";

export async function POST() {
 const supabase = await supabaseFromCookies();
 const { data: authData, error: authErr } = await supabase.auth.getUser();
 if (authErr || !authData.user) {
 return new NextResponse("Unauthorized", { status:401 });
 }

 const userId = authData.user.id;

 const { data: game, error: gameErr } = await supabase
 .from("games")
 .select("*")
 .eq("user_id", userId)
 .maybeSingle();

 if (gameErr) return new NextResponse(gameErr.message, { status:500 });
 if (!game) return new NextResponse("No game to reset", { status:404 });

 const nextRun = Number(game.run_no ??1) +1;

 // Start a new run by bumping `run_no` and resetting the snapshot in-place.
 // We intentionally DO NOT delete `quarters` (or `jobs`) so the user can view history.
 const { data: resetGame, error: resetErr } = await supabase
 .from("games")
 .update({
 run_no: nextRun,
 year:1,
 quarter:1,
 cash:1_000_000,
 engineers:4,
 sales_staff:2,
 quality:50,
 is_over: false,
 // This is the "active" run; ended_reason is only meaningful at end-of-run.
 ended_reason: null,
 updated_at: new Date().toISOString(),
 })
 .eq("id", game.id)
 .select("*")
 .single();

 if (resetErr) return new NextResponse(resetErr.message, { status:500 });

 return NextResponse.json({ ok: true, game: resetGame });
}
