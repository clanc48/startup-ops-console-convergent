type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

// Best-effort in-memory fixed-window rate limiter.
// This is NOT a substitute for a shared store (Redis) in multi-instance deployments,
// but it's enough to prevent trivial abuse for this take-home.

type Bucket = { windowStartMs: number; count: number };

const GLOBAL_KEY = "__rate_limit_buckets__";

function buckets(): Map<string, Bucket> {
  const g: any = globalThis as any;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map<string, Bucket>();
  return g[GLOBAL_KEY];
}

export function rateLimit(key: string, opts: { limit: number; windowMs: number }): RateLimitResult {
  const now = Date.now();
  const map = buckets();
  const b = map.get(key);

  if (!b || now - b.windowStartMs >= opts.windowMs) {
    map.set(key, { windowStartMs: now, count: 1 });
    return { ok: true };
  }

  if (b.count >= opts.limit) {
    const retryAfterMs = opts.windowMs - (now - b.windowStartMs);
    return { ok: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  b.count += 1;
  map.set(key, b);
  return { ok: true };
}
