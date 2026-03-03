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

 // Remove ledger + jobs first, then reset snapshot.
 const { error: qDelErr } = await supabase
 .from("quarters")
 .delete()
 .eq("game_id", game.id);
 if (qDelErr) return new NextResponse(qDelErr.message, { status:500 });

 const { error: jDelErr } = await supabase
 .from("jobs")
 .delete()
 .eq("game_id", game.id);
 if (jDelErr) return new NextResponse(jDelErr.message, { status:500 });

 const { error: gUpErr } = await supabase
 .from("games")
 .update({
 year:1,
 quarter:1,
 // Spec defaults
 cash:1_000_000,
 engineers:4,
 sales_staff:2,
 quality:50,
 is_over:false,
 ended_reason:null,
 })
 .eq("id", game.id);

 if (gUpErr) return new NextResponse(gUpErr.message, { status:500 });

 return NextResponse.json({ ok:true });
}
