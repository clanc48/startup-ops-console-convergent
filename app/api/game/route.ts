import { NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { supabaseFromCookies } from "@/lib/supabaseServer";
import { computeInsights } from "@/lib/insights";

function debugEnabled() {
 return process.env.DEBUG_SERVER === "1";
}

function safeCookieNamesFromHeader(cookieHeader: string | null) {
 if (!cookieHeader) return [] as string[];
 return cookieHeader
 .split(";")
 .map((c) => c.trim())
 .map((c) => c.split("=")[0])
 .filter(Boolean);
}

function parseLimit(url: URL) {
 const raw = url.searchParams.get("limit");
 const n = raw ? Number(raw) : NaN;
 if (!Number.isFinite(n)) return 4;
 // Bound to keep payload reasonable.
 return Math.max(1, Math.min(40, Math.trunc(n)));
}

export async function GET(req: Request) {
 const url = new URL(req.url);
 const limit = parseLimit(url);

 const h = await headers();
 const cookieHeader = h.get("cookie");

 if (debugEnabled()) {
 const cookieStore = await cookies();
 const cookieNamesFromStore = cookieStore.getAll().map((c) => c.name);

 // Only log cookie *names* (never values)
 console.log("/api/game debug", {
 has_cookie_header: Boolean(cookieHeader),
 cookie_names_from_header: safeCookieNamesFromHeader(cookieHeader),
 cookie_names_from_store: cookieNamesFromStore,
 user_agent: h.get("user-agent"),
 referer: h.get("referer"),
 });
 }

 const supabase = await supabaseFromCookies();
 const { data: authData, error: authErr } = await supabase.auth.getUser();

 if (debugEnabled()) {
 console.log("/api/game auth", {
 auth_error: authErr ? { name: authErr.name, message: authErr.message, status: (authErr as any).status } : null,
 has_user: Boolean(authData?.user),
 user_id: authData?.user?.id ?? null,
 });
 }

 if (authErr || !authData.user) return new NextResponse("Unauthorized", { status:401 });

 const userId = authData.user.id;

 const { data: game, error: gameErr } = await supabase
 .from("games")
 .select("*")
 .eq("user_id", userId)
 .maybeSingle();

 if (debugEnabled() && gameErr) {
 console.error("/api/game db.games.select_failed", {
 message: gameErr.message,
 details: (gameErr as any).details,
 hint: (gameErr as any).hint,
 code: (gameErr as any).code,
 });
 }

 let ensuredGame: any = game;

 if (!ensuredGame && !gameErr) {
 const { data: created, error: createErr } = await supabase
 .from("games")
 .insert({
 user_id: userId,
 year:1,
 quarter:1,
 run_no:1,
 // Spec defaults
 cash:1_000_000,
 engineers:4,
 sales_staff:2,
 quality:50,
 is_over: false,
 ended_reason: null,
 })
 .select("*")
 .single();

 if (debugEnabled() && createErr) {
 console.error("/api/game db.games.insert_failed", {
 message: createErr.message,
 details: (createErr as any).details,
 hint: (createErr as any).hint,
 code: (createErr as any).code,
 });
 }

 if (createErr) return new NextResponse(createErr.message, { status:500 });
 ensuredGame = created;
 }

 if (!ensuredGame) return new NextResponse("Failed to load game", { status:500 });

 const runNo = Number(ensuredGame.run_no ??1);

 const { data: quarters, error: qErr } = await supabase
 .from("quarters")
 .select("*")
 .eq("game_id", ensuredGame.id)
 .eq("run_no", runNo)
 .order("created_at", { ascending: false })
 .limit(limit);

 if (debugEnabled() && qErr) {
 console.error("/api/game db.quarters.select_failed", {
 message: qErr.message,
 details: (qErr as any).details,
 hint: (qErr as any).hint,
 code: (qErr as any).code,
 });
 }

 if (qErr) return new NextResponse(qErr.message, { status:500 });

 const last_quarters = (quarters ?? []).map((q: any) => ({ ...q }));

 const insights = computeInsights(ensuredGame, last_quarters as any);

 // Spec wants cumulative profit (sum of net income over all quarters).
 // Scope to current run so it matches what the dashboard shows.
 const { data: allNet, error: netErr } = await supabase
 .from("quarters")
 .select("net_income")
 .eq("game_id", ensuredGame.id)
 .eq("run_no", runNo);

 if (debugEnabled() && netErr) {
 console.error("/api/game db.quarters.select_net_failed", {
 message: netErr.message,
 details: (netErr as any).details,
 hint: (netErr as any).hint,
 code: (netErr as any).code,
 });
 }

 if (netErr) return new NextResponse(netErr.message, { status:500 });

 const cumulative_profit = (allNet ?? []).reduce((acc: number, r: any) => acc + Number(r.net_income ??0),0);

 return NextResponse.json({ game: ensuredGame, last_quarters, insights, cumulative_profit });
}
