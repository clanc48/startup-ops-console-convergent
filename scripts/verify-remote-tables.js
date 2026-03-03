#!/usr/bin/env node

/**
 * Verify remote Supabase tables WITHOUT Docker by using the PostgREST REST API.
 *
 * Usage:
 * node scripts/verify-remote-tables.js
 *
 * Requires `.env.local` with:
 * NEXT_PUBLIC_SUPABASE_URL
 * SUPABASE_SERVICE_ROLE_KEY (preferred) OR NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 */

const fs = require("fs");
const path = require("path");

function readEnvFile(filepath) {
 const out = {};
 if (!fs.existsSync(filepath)) return out;
 const raw = fs.readFileSync(filepath, "utf8");
 for (const line of raw.split(/\r?\n/)) {
 const trimmed = line.trim();
 if (!trimmed || trimmed.startsWith("#")) continue;
 const idx = trimmed.indexOf("=");
 if (idx <0) continue;
 const k = trimmed.slice(0, idx).trim();
 const v = trimmed.slice(idx +1).trim();
 out[k] = v;
 }
 return out;
}

async function httpGet(url, headers) {
 const res = await fetch(url, { method: "GET", headers });
 const text = await res.text();
 return { ok: res.ok, status: res.status, text };
}

(async () => {
 const envPath = path.join(process.cwd(), ".env.local");
 const fileEnv = readEnvFile(envPath);

 const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
 const apiKey =
 process.env.SUPABASE_SERVICE_ROLE_KEY ||
 fileEnv.SUPABASE_SERVICE_ROLE_KEY ||
 process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
 fileEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

 if (!sbUrl || !apiKey) {
 console.error("Missing NEXT_PUBLIC_SUPABASE_URL or an API key (SUPABASE_SERVICE_ROLE_KEY preferred). Check .env.local");
 process.exit(2);
 }

 const base = sbUrl.replace(/\/+$/, "");
 const headers = {
 apikey: apiKey,
 Authorization: `Bearer ${apiKey}`,
 Accept: "application/json",
 };

 // Cheap health check
 const healthUrl = `${base}/rest/v1/?select=1`;
 const health = await httpGet(healthUrl, headers);
 if (!health.ok) {
 console.error(`PostgREST not reachable: ${health.status}`);
 console.error(health.text.slice(0,500));
 process.exit(3);
 }

 // We can verify specific required tables without introspection privileges.
 // A HEAD request would be ideal but fetch HEAD + CORS sometimes odd; use GET with limit.
 const required = ["games", "quarters", "jobs"];

 let okCount =0;
 for (const t of required) {
 const url = `${base}/rest/v1/${encodeURIComponent(t)}?select=*&limit=1`;
 const r = await httpGet(url, headers);

 if (r.ok) {
 console.log(`OK: table '${t}' is accessible via PostgREST`);
 okCount++;
 continue;
 }

 // PostgREST table missing in schema cache: PGRST205
 let code;
 try {
 const j = JSON.parse(r.text);
 code = j.code;
 } catch {
 // ignore
 }

 console.log(`FAIL: table '${t}' not accessible (HTTP ${r.status}${code ? `, ${code}` : ""})`);
 console.log(r.text.slice(0,300));
 }

 if (okCount === required.length) {
 console.log("All required tables appear present and accessible.");
 process.exit(0);
 }

 console.log("One or more required tables are missing/inaccessible.");
 console.log("If you just applied migrations, PostgREST schema cache may need a reload.");
 process.exit(1);
})();
