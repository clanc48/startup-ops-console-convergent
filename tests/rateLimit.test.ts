import assert from "node:assert/strict";
import test from "node:test";
import { rateLimit } from "../lib/rateLimit.ts";

test("blocks requests after the configured fixed-window limit", () => {
  const key = `test-${Date.now()}-${Math.random()}`;

  assert.deepEqual(rateLimit(key, { limit: 2, windowMs: 60_000 }), { ok: true });
  assert.deepEqual(rateLimit(key, { limit: 2, windowMs: 60_000 }), { ok: true });

  const blocked = rateLimit(key, { limit: 2, windowMs: 60_000 });
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.ok(blocked.retryAfterMs > 0);
});
