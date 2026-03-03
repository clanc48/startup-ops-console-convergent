import { NextResponse } from "next/server";
import { supabaseFromCookies } from "@/lib/supabaseServer";

// Dev-safe endpoint: allow authenticated users to request shutdown when they are the only active player.
export async function POST(req: Request) {
 // Block if not local and not dev to reduce blast radius
 const host = req.headers.get("host") ?? "";
 const isProd = process.env.NODE_ENV === "production";
 if (isProd && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
 return new NextResponse("Forbidden", { status:403 });
 }

 const supabase = await supabaseFromCookies();
 const { data: authData, error: authErr } = await supabase.auth.getUser();
 if (authErr || !authData.user) {
 return new NextResponse("Unauthorized", { status:401 });
 }

 const userId = authData.user.id;

 // In production require worker token header as an additional guard
 if (isProd) {
 const token = req.headers.get("x-worker-token") ?? "";
 const expected = process.env.WORKER_TOKEN ?? "";
 if (!expected || token !== expected) {
 return new NextResponse("Unauthorized", { status:401 });
 }
 }

 // Safety check: ensure this instance only has one active player (is_over = false)
 const { data: activeGames, error: gErr } = await supabase
 .from("games")
 .select("user_id")
 .eq("is_over", false);

 if (gErr) return new NextResponse(gErr.message, { status:500 });

 const players = new Set((activeGames ?? []).map((g: any) => g.user_id));
 if (players.size >1) {
 return new NextResponse("Multiple active players detected. Aborting shutdown.", { status:409 });
 }

 if (!players.has(userId)) {
 return new NextResponse("Unauthorized: current user does not own the active game.", { status:401 });
 }

 setTimeout(() => {
 try {
 // eslint-disable-next-line no-process-exit
 process.exit(0);
 } catch {
 // ignore
 }
 },500);

 return NextResponse.json({ ok: true, msg: "Shutting down" });
}
