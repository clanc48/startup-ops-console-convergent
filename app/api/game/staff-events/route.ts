import { NextResponse } from "next/server";
import { supabaseFromCookies } from "@/lib/supabaseServer";

function parseLimit(url: URL) {
	const raw = url.searchParams.get("limit");
	const n = raw ? Number(raw) : NaN;
	if (!Number.isFinite(n)) return 200;
	return Math.max(1, Math.min(2000, Math.trunc(n)));
}

export async function GET(req: Request) {
	const url = new URL(req.url);
	const limit = parseLimit(url);

	const supabase = await supabaseFromCookies();
	const { data: authData, error: authErr } = await supabase.auth.getUser();
	if (authErr || !authData.user) return new NextResponse("Unauthorized", { status: 401 });
	const userId = authData.user.id;

	const { data: game, error: gErr } = await supabase
		.from("games")
		.select("id,run_no")
		.eq("user_id", userId)
		.maybeSingle();

	if (gErr || !game) return new NextResponse("Game not found", { status: 404 });

	const runNo = Number((game as any).run_no ?? 1);

	const { data: events, error: eErr } = await supabase
		.from("staff_events")
		.select("delta_engineers,delta_sales,created_at")
		.eq("game_id", (game as any).id)
		.eq("run_no", runNo)
		.order("created_at", { ascending: true })
		.limit(limit);

	if (eErr) return new NextResponse(eErr.message, { status: 500 });
	return NextResponse.json(events ?? []);
}
