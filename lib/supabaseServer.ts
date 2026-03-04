import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "@/lib/env";

type CookieStore = Awaited<ReturnType<typeof cookies>>;
type CookieToSet = { name: string; value: string; options?: Parameters<CookieStore["set"]>[2] };

export async function supabaseFromCookies() {
 const cookieStore = await cookies();
 const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } = getSupabasePublicEnv();

 return createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
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
}
