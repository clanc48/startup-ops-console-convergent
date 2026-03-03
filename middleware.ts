import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] };

export async function middleware(req: NextRequest) {
 // Create a response we can attach refreshed auth cookies to.
 const res = NextResponse.next({ request: { headers: req.headers } });

 const supabase = createServerClient(
 process.env.NEXT_PUBLIC_SUPABASE_URL!,
 process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
 {
 cookies: {
 getAll() {
 return req.cookies.getAll();
 },
 setAll(cookiesToSet: CookieToSet[]) {
 cookiesToSet.forEach(({ name, value, options }) => {
 res.cookies.set(name, value, options);
 });
 },
 },
 }
 );

 // IMPORTANT: Trigger a session refresh/read so any auth cookies are set.
 // Without this, no cookie mutations occur.
 await supabase.auth.getUser();

 return res;
}

// Avoid running middleware on static assets.
export const config = {
 matcher: [
 "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
 ],
};
