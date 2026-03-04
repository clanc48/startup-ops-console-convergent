# Startup Ops Console (Option A) — v2

## Write-up (≤200 words)
This project implements a single-player, turn-based startup simulation (one “turn” = one quarter). The player sets price, hiring, and salary strategy, then advances the quarter to see updated financials, headcount, and an office visualization. All simulation outcomes are computed and persisted server-side so the client can’t fudge the numbers.

One technical decision I stand behind: modeling state as an immutable `quarters` ledger plus a `games` snapshot. The ledger makes it easy to debug and chart history while the snapshot keeps dashboard reads fast and simple. Both are updated together via a single transactional Postgres function (`advance_game`), which avoids partial writes and keeps the UI consistent.

If I had more time, I’d tighten the auth bridge flow so it’s harder to misconfigure across environments and add more robust job scheduling/observability.

## Non-core additions (intentional)
These extras are not required by the core prompt, but are included to improve reviewability and UX.

### Tooling
- Linting: `eslint.config.js` + `npm run lint` to catch unused/accidental code and common React hooks issues.
- ESM mode: `package.json` sets `"type": "module"` so ESLint flat config can run as ESM; `next.config.js` is written as ESM (`export default`).

Tooling note: `"type": "module"` is intentional. It prevents Node from warning when loading `eslint.config.js` (which uses ESM syntax). Because of that, `next.config.js` is also written in ESM.

### Next.js runtime glue
- `proxy.ts` replaces the deprecated `middleware.ts` convention in Next16+. It refreshes Supabase SSR auth cookies so server routes can reliably read sessions.

### Optional AI workflow (disabled by default)
AI is optional; the core game loop works without it.

- `POST /api/ai/notes` generates (and caches) `quarters.ai_summary` for a given quarter.
- `POST /api/jobs/worker` processes `jobs` of type `ai_summary` and writes `quarters.ai_summary`.

AI is gated behind `ENABLE_AI` (see `lib/envFlags.ts`). When disabled, AI endpoints return `404`.

## What you get (mapped to the spec)
- Auth + session persistence: Supabase email/password; server routes authenticate via cookies
- Quarterly decision panel: price, hires (engineers/sales), salary % (1–200; default100)
- Advance turn: `POST /api/game/advance` (server-authoritative)
- Dashboard: cash, revenue, net income, headcount, current quarter + last4 quarters history
- Office visualization: a30-desk grid that fills by role (E/S); empty desks remain visible
- Win/lose: lose when a quarter ends with `cash_end <=0`; win when completing Y10 Q4 with `cash_end >0` (win screen includes cumulative profit)

## Bonus pages (optional)
These pages are **not required by the prompt**, but are included as extra views over the same server-authoritative data.

They all load the same read-only dashboard payload (`GET /api/game?limit=20`) and **do not mutate game state**.

- `/financials` — revenue/net/cash trend views
- `/staffing` — headcount/payroll views
- `/operations` — operations-focused view (office + quality/runway)
- `/history` — run history / ledger browsing

## How it works (architecture)

### Data model
- `games`: current snapshot (fast reads for the dashboard)
- `quarters`: immutable-ish history/ledger (charts + analytics)
- `jobs`: optional background queue (AI summaries only)

### Server-authoritative turn advance
- Client submits decisions → `POST /api/game/advance`
- Server validates inputs (non-negative numbers, hire counts coerced to integers, `salary_pct` must be1–200)
- Server calls a transactional Postgres function `advance_game` which:
 - applies the simulation model in-database
 - inserts a new `quarters` row
 - updates the `games` snapshot
 - enforces win/lose rules

Model fidelity:
- Model: implements the assignment prompt’s formulas and constants exactly (including industry average salary = $30,000/quarter/employee and hire cost = $5,000 per hire).
- Constants changed: none.

### Realtime UI
The UI subscribes to Supabase Realtime Postgres changes, so new quarters / snapshot updates appear without a full refresh. Realtime is for UX only; the server/DB remains the source of truth.

### Auth bridge (client tokens → HttpOnly cookies)
Client-side Supabase sessions live in browser storage, but server routes can’t read that.

- Client calls `POST /api/auth/session` with `{ access_token, refresh_token }`
- Server validates/adopts the session via Supabase, then sets Supabase’s auth cookies
- After that, server endpoints authenticate via `cookies()`

### Optional: Jobs + worker (AI executive summaries)
AI summaries are **not required** for the core simulation.

- Core game requires: `games` + `quarters`
- Optional AI summaries use: `jobs` + `quarters.ai_summary`

When enabled:
- Advancing a quarter enqueues an `ai_summary` job in `jobs`
- `POST /api/jobs/worker` processes queued jobs and writes `quarters.ai_summary`

Worker security (when AI is enabled):
- Production deployments should require `X-Worker-Token: $WORKER_TOKEN` and enforce rate limiting.

## Setup (under5 commands)

### Windows (recommended)
```powershell
./scripts/launch.ps1
```
The wizard creates/updates `.env.local`, optionally pushes migrations, and starts the app.

### Manual setup (any OS) — still ≤5 commands
```bash
npm install
cp .env.local.example .env.local
# edit .env.local with your Supabase keys
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase db push --include-all --yes
npm run dev
```

## Environment variables

Client-safe:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Server-only:
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` (optional; only if you want AI summaries)
- `WORKER_TOKEN` (only required in production for the worker endpoint)

Feature flags:
- `ENABLE_AI` (default `false`; required to expose AI endpoints)

## API quick reference

Core:
- `POST /api/auth/session` — token → cookie bridge for SSR/server routes
- `GET /api/game` — get current game (includes `cumulative_profit`)
- `POST /api/game/advance` — advance one quarter (server-authoritative)
- `POST /api/game/reset` — reset game

Optional (AI):
- `POST /api/ai/notes` — generate/cache `quarters.ai_summary`
- `POST /api/jobs/worker` — process one queued job

## Tradeoffs / descopes
- Worker scheduling is intentionally minimal: local runs are manual; production expects an external scheduler/cron.
- Office visualization prioritizes clarity (role split + empty capacity) over detailed art.

## Known issues / notes
- Supabase PostgREST schema cache can lag right after migrations; the launch wizard includes retries when verifying tables.
- `POST /api/close` is a dev-only utility endpoint (returns404 in production).
- Don’t commit secrets. If you did, rotate them immediately.
