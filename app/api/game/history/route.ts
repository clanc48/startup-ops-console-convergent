import { NextResponse } from "next/server";
import { supabaseFromCookies } from "@/lib/supabaseServer";

function asNum(v: any) {
 const n = Number(v);
 return Number.isFinite(n) ? n :0;
}

export async function GET() {
 const supabase = await supabaseFromCookies();
 const { data: authData, error: authErr } = await supabase.auth.getUser();
 if (authErr || !authData.user) return new NextResponse("Unauthorized", { status:401 });

 const userId = authData.user.id;

 const { data: game, error: gameErr } = await supabase
 .from("games")
 .select("id, run_no")
 .eq("user_id", userId)
 .maybeSingle();

 if (gameErr) return new NextResponse(gameErr.message, { status:500 });
 if (!game) return new NextResponse("Game not found", { status:404 });

 const gameId = game.id;
 const currentRun = Number(game.run_no ??1);

 const { data: rows, error: qErr } = await supabase
 .from("quarters")
 .select("*")
 .eq("game_id", gameId)
 .order("run_no", { ascending: false })
 .order("created_at", { ascending: true });

 if (qErr) return new NextResponse(qErr.message, { status:500 });

 const plain = (rows ?? []).map((q: any) => ({ ...q }));

 // Group by run_no
 const byRun = new Map<number, any[]>();
 for (const q of plain) {
 const r = Number(q.run_no ??1);
 const arr = byRun.get(r) ?? [];
 arr.push(q);
 byRun.set(r, arr);
 }

 const runs = Array.from(byRun.entries())
 .sort((a, b) => b[0] - a[0])
 .map(([run_no, quarters]) => {
 const cumulative_profit = quarters.reduce((acc, q) => acc + asNum(q.net_income),0);
 const first = quarters[0] ?? null;
 const last = quarters[quarters.length -1] ?? null;

 return {
 run_no,
 is_current: run_no === currentRun,
 started_at: first?.created_at ?? null,
 last_played_at: last?.created_at ?? null,
 quarters_count: quarters.length,
 cumulative_profit,
 quarters,
 };
 });

 return NextResponse.json({ game_id: gameId, current_run_no: currentRun, runs });
}
