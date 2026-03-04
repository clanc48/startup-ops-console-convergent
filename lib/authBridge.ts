import { supabase } from "@/lib/supabaseClient";

/**
 * Client -> server auth bridge.
 *
 * After a successful client-side login, call this to convert the browser session
 * (local storage) into Supabase SSR HttpOnly cookies so that server route
 * handlers can authenticate via `cookies()`.
 */
export async function bridgeSessionToCookies(): Promise<void> {
 const { data, error } = await supabase.auth.getSession();
 if (error) throw error;

 const access_token = data.session?.access_token;
 const refresh_token = data.session?.refresh_token;
 if (!access_token || !refresh_token) {
 throw new Error("No session tokens available to bridge.");
 }

 const r = await fetch("/api/auth/session", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 credentials: "include",
 body: JSON.stringify({ access_token, refresh_token }),
 });

 if (!r.ok) {
 throw new Error(await r.text());
 }
}

/**
 * Keep server cookies in sync with the client session.
 *
 * Call once from a client component that mounts early (e.g. `app/layout.tsx` or
 * the main app page). When Supabase rotates tokens, we re-bridge.
 */
export function installAuthBridgeListener(): { unsubscribe: () => void } {
 const {
 data: { subscription },
 } = supabase.auth.onAuthStateChange(async (_event, session) => {
 // Only bridge when we have a session.
 // (signOut should just clear client state; server routes will401 naturally)
 if (!session) return;
 try {
 await fetch("/api/auth/session", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 credentials: "include",
 body: JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }),
 });
 } catch {
 // Non-fatal; app will still work client-side and can retry next auth event.
 }
 });

 return { unsubscribe: () => subscription.unsubscribe() };
}
