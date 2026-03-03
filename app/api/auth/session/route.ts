import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieStore = Awaited<ReturnType<typeof cookies>>;
type CookieToSet = { name: string; value: string; options?: Parameters<CookieStore["set"]>[2] };

// Exchanges client-side tokens for HttpOnly cookies (SSR auth bridge).
// This enables server routes (e.g. /api/game) to authenticate via cookies().
export async function POST(req: Request) {
 let body: any;
 try {
 body = await req.json();
 } catch {
 return new NextResponse("Invalid JSON", { status:400 });
 }

 const access_token = body?.access_token as string | undefined;
 const refresh_token = body?.refresh_token as string | undefined;
 if (!access_token || !refresh_token) {
 return new NextResponse("Missing access_token/refresh_token", { status:400 });
 }

 const cookieStore = await cookies();
 const supabase = createServerClient(
 process.env.NEXT_PUBLIC_SUPABASE_URL!,
 process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
 {
 cookies: {
 getAll() {
 return cookieStore.getAll();
 },
 setAll(cookiesToSet: CookieToSet[]) {
 cookiesToSet.forEach(({ name, value, options }) => {
 cookieStore.set(name, value, options);
 });
 },
 },
 }
 );

 const { error } = await supabase.auth.setSession({ access_token, refresh_token });
 if (error) return new NextResponse(error.message, { status:401 });

 return NextResponse.json({ ok: true });
}
