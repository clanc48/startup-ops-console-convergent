import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { debugServerEnabled, getSupabasePublicEnv } from "@/lib/env";

type CookieStore = Awaited<ReturnType<typeof cookies>>;
// `cookies().set()` is basically: set(name, value, options).
// Supabase hands us an array of cookies it wants on the response; we just forward
// the same `options` shape Next expects so things like `httpOnly`, `secure`,
// `sameSite`, and expiration don’t get lost.
type CookieToSet = {
 name: string;
 value: string;
 options?: Parameters<CookieStore["set"]>[2];
};

function cookieNames(store: CookieStore) {
 return store.getAll().map((c) => c.name);
}

/**
 * SSR auth bridge (client tokens -> server cookies)
 * -------------------------------------------------
 * The problem:
 * - On the client, Supabase Auth can keep the session in browser storage.
 * - On the server, Route Handlers only see the incoming request (headers/cookies).
 * They *cannot* read the browser’s local storage, so they don’t automatically
 * know who the user is.
 *
 * The fix:
 * - The client calls this endpoint once after login (or whenever it gets a fresh session)
 * and sends `{ access_token, refresh_token }`.
 * - We ask Supabase to “adopt” that session via `setSession()`.
 * - Supabase responds by telling us which auth cookies to set (HttpOnly).
 * - Next.js attaches those cookies to the response.
 */
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
 const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } = getSupabasePublicEnv();

 if (debugServerEnabled()) {
 console.log("/api/auth/session.start", {
 cookie_names_in: cookieNames(cookieStore),
 });
 }

 const supabase = createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
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
 });

 const { error } = await supabase.auth.setSession({ access_token, refresh_token });
 if (error) {
 if (debugServerEnabled()) {
 console.log("/api/auth/session.fail", {
 message: error.message,
 cookie_names_out: cookieNames(cookieStore),
 });
 }
 return new NextResponse(error.message, { status:401 });
 }

 if (debugServerEnabled()) {
 console.log("/api/auth/session.ok", {
 cookie_names_out: cookieNames(cookieStore),
 });
 }

 return NextResponse.json({ ok: true });
}
