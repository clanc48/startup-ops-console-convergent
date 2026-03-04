// Centralized environment configuration helpers.

export function envFlag(name: string, defaultValue: boolean) {
 const raw = process.env[name];
 if (raw === undefined) return defaultValue;
 const v = String(raw).trim().toLowerCase();
 if (["1", "true", "yes", "y", "on"].includes(v)) return true;
 if (["0", "false", "no", "n", "off"].includes(v)) return false;
 return defaultValue;
}

// Optional AI/queue workflow demo (disabled by default).
export const ENABLE_AI = envFlag("ENABLE_AI", false);

// Worker security: require a shared secret token by default.
// If you explicitly want to allow unauthenticated worker calls in dev, set ALLOW_DEV_WORKER=true.
export const ALLOW_DEV_WORKER = envFlag("ALLOW_DEV_WORKER", false);

export function requireEnv(name: string) {
 const v = process.env[name];
 if (!v) throw new Error(`Missing required env var: ${name}`);
 return v;
}
