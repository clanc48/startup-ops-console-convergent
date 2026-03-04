import { NextResponse } from "next/server";
import { ENABLE_AI } from "@/lib/envFlags";
import { supabaseFromCookies } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { generateExecutiveSummary } from "@/lib/aiExecutiveSummary";
import { requestId, logInfo, logError } from "@/lib/observability";

/**
 * Generate (and cache) an AI executive summary for a quarter.
 *
 * This is a convenience endpoint for bonus pages so reviewers can see AI output
 * without running the demo worker route.
 */
export async function POST(req: Request) {
 // Optional feature: hide endpoint entirely when disabled.
 if (!ENABLE_AI) return new NextResponse("Not Found", { status:404 });

 const rid = requestId();

 if (!process.env.OPENAI_API_KEY) {
 return new NextResponse("OPENAI_API_KEY not set", { status:501 });
 }

 const supabase = await supabaseFromCookies();
 const { data: authData, error: authErr } = await supabase.auth.getUser();
 if (authErr || !authData.user) return new NextResponse("Unauthorized", { status:401 });

 let body: any = null;
 try {
 body = await req.json();
 } catch {
 // Allow empty body (defaults to latest quarter).
 }

 const quarterId = body?.quarter_id as string | undefined;

 // Load current user's game to scope access.
 const { data: game, error: gErr } = await supabase.from("games").select("*").eq("user_id", authData.user.id).single();
 if (gErr || !game) return new NextResponse("Game not found", { status:404 });

 // Load target quarter (default: newest for this run).
 let quarter: any = null;
 if (quarterId) {
 const { data, error } = await supabase.from("quarters").select("*").eq("id", quarterId).single();
 if (error || !data) return new NextResponse("Quarter not found", { status:404 });
 quarter = data;
 } else {
 const runNo = Number((game as any).run_no ??1);
 const { data, error } = await supabase
 .from("quarters")
 .select("*")
 .eq("game_id", (game as any).id)
 .eq("run_no", runNo)
 .order("created_at", { ascending: false })
 .limit(1)
 .maybeSingle();
 if (error || !data) return new NextResponse("No quarters yet", { status:404 });
 quarter = data;
 }

 // Ensure the quarter belongs to the user's game.
 if (quarter.game_id !== (game as any).id) return new NextResponse("Forbidden", { status:403 });

 if (quarter.ai_summary) {
 logInfo("ai.notes.cached", { rid, quarter_id: quarter.id });
 return NextResponse.json({ ok: true, cached: true, ai_summary: quarter.ai_summary, quarter_id: quarter.id });
 }

 const runNo = Number(quarter.run_no ?? (game as any).run_no ??1);
 const { data: last4, error: lErr } = await supabase
 .from("quarters")
 .select("*")
 .eq("game_id", (game as any).id)
 .eq("run_no", runNo)
 .order("created_at", { ascending: false })
 .limit(4);

 if (lErr) return new NextResponse(`Failed to load last quarters: ${lErr.message}`, { status:500 });

 const last4Plain = (last4 ?? []).map((q: any) => ({ ...q }));

 try {
 const summary = await generateExecutiveSummary({ game, quarter, lastQuarters: last4Plain });

 // Write summary using admin client so we can update without relying on a client write policy.
 const { error: updErr } = await supabaseAdmin.from("quarters").update({ ai_summary: summary }).eq("id", quarter.id);
 if (updErr) return new NextResponse(`Failed to write summary: ${updErr.message}`, { status:500 });

 logInfo("ai.notes.generated", { rid, quarter_id: quarter.id });
 return NextResponse.json({ ok: true, cached: false, ai_summary: summary, quarter_id: quarter.id });
 } catch (e: any) {
 const msg = e?.message ?? String(e);
 logError("ai.notes.failed", { rid, error: msg });
 return new NextResponse(msg, { status:500 });
 }
}
