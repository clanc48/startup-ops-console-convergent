export type ServerEnv = {
 NEXT_PUBLIC_SUPABASE_URL: string;
 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
 SUPABASE_SERVICE_ROLE_KEY?: string;
 DEBUG_SERVER?: string;
};

function req(name: keyof ServerEnv): string {
 const v = process.env[name];
 if (!v) throw new Error(`Missing required env var: ${name}`);
 return v;
}

export function getSupabasePublicEnv(): Pick<ServerEnv, "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"> {
 return {
 NEXT_PUBLIC_SUPABASE_URL: req("NEXT_PUBLIC_SUPABASE_URL"),
 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: req("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
 };
}

export function debugServerEnabled(): boolean {
 return process.env.DEBUG_SERVER === "1";
}
