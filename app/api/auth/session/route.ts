import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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
 *
 * End result:
 * - From then on, your server endpoints can trust `cookies()` for auth.
 * - Your other routes can use the SSR client and do things like
 * `supabase.auth.getUser()` without the browser having to resend tokens.
 *
 * Payload:
 * ```json
 * { "access_token": "...", "refresh_token": "..." }
 * ```
 *
 * Security notes (worth repeating):
 * - These tokens are credentials. Only send them over HTTPS.
 * - Don’t log them.
 */
export async function POST(req: Request) {
 // Grab JSON from the request. If it’s not valid JSON, we can’t do anything.
 let body: any;
 try {
 body = await req.json();
 } catch {
 return new NextResponse("Invalid JSON", { status:400 });
 }

 // We need both tokens:
 // - access: proves the user right now
 // - refresh: lets Supabase rotate/refresh when access expires
 const access_token = body?.access_token as string | undefined;
 const refresh_token = body?.refresh_token as string | undefined;
 if (!access_token || !refresh_token) {
 return new NextResponse("Missing access_token/refresh_token", { status:400 });
 }

 // Next.js gives us a request-scoped cookie store.
 // Think of this as: “read cookies from the request” + “queue cookies to write on the response”.
 const cookieStore = await cookies();

 // Wire Supabase’s SSR client into Next’s cookie system.
 // - `getAll()` lets Supabase read whatever cookies came in.
 // - `setAll()` is how Supabase tells us what to write back.
 // (We’re not inventing cookie settings here; we’re relaying what Supabase wants.)
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

 // This is the actual “bridge” step.
 // If the tokens are bad/expired, Supabase will reject them and we return401.
 const { error } = await supabase.auth.setSession({ access_token, refresh_token });
 if (error) return new NextResponse(error.message, { status:401 });

 // The main output is the HttpOnly cookies we just set.
 // Returning `{ ok: true }` just gives the client a simple “yep, done” signal.
 return NextResponse.json({ ok: true });
}
