# Startup Ops Console (Option A) — v2 (Realtime + AI + Jobs)

## Write-up (≤200 words)
This project is a single-player, turn-based startup simulation where each quarter you choose pricing, hiring, and salary strategy, then review the resulting financial and operational outcomes. The goal is to survive to Year10 without running out of cash.

One technical decision I stand behind is modeling state as an immutable `quarters` ledger plus a `games` snapshot. The ledger makes the simulation auditable (easy to debug and chart), while the snapshot keeps reads fast for the dashboard. This structure also maps cleanly to server-authoritative updates via a single `POST /api/game/advance` action.

This version enforces win/lose server-side: you **win** by completing **Y10 Q4** with positive cash and you **lose** immediately if cash_end <= 0.

## Features
- Supabase Auth (email/password)
- Supabase Postgres persistence
- Next.js route handlers as server-authoritative backend
- Immutable quarter ledger (`quarters`) + current snapshot (`games`)
- Realtime dashboard updates via Supabase Realtime Postgres changes
- Advisor/Insights panel generated server-side
- SHA-256 integrity checksum per quarter + verify-on-read badge
- Background job queue (`jobs`) + worker endpoint to generate AI executive summaries
- AI summary generated via Vercel AI SDK + OpenAI provider and stored in `quarters.ai_summary` (acts as cache)

## Setup
1) Create a Supabase project
2) Run `supabase/schema.sql` in Supabase SQL editor
3) Copy `.env.local.example` -> `.env.local` and fill keys
4) Install + run:

```bash
npm install
npm run dev
```

Open http://localhost:3000


## Supabase key note
This app uses the **Supabase Publishable API Key** (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). If your project only shows a legacy `anon` key, you can paste that value into the publishable key field (they both act as the public client key).

## Notes
- Simulation constants follow the assignment spec (including $30,000/quarter industry average salary).
- `salary_pct` is validated server-side as **1–200** (0% payroll is disallowed).
- The game advance is transactional via a Postgres function (`advance_game`) to keep the `quarters` ledger and `games` snapshot consistent under failures.
- Row Level Security (RLS) policies scope `games`, `quarters`, and `jobs` to the authenticated user.
- `POST /api/game/advance` enqueues an `ai_summary` job in `jobs`.
- Click **Run Worker Once** in the UI to process one job locally (disabled in production).
- In production, schedule the worker via cron/scheduler and call `POST /api/jobs/worker` with `X-Worker-Token: $WORKER_TOKEN`.
