# Startup Ops Console

> **Archived technical exercise / public code sample**  
> This repository is retained for architecture and code-review purposes. It is **not currently deployed**, does not represent an active production service, and should be run only against a Supabase project you control.

Startup Ops Console is a single-player, turn-based startup simulation built with Next.js, TypeScript, Supabase/PostgreSQL, and optional AI summaries. A player chooses price, hiring, and salary strategy; the server advances one quarter and persists the resulting financial and staffing state.

The useful part of this repository is not the game theme. It is the implementation of several application-engineering concerns in a compact, inspectable project: server-authoritative state, transactional database mutation, row-level access controls, session handoff between browser and server routes, concurrency handling, append-only history, background work, and explicit operational tradeoffs.

## Review status

The original project was created as a technical exercise and later retained as a portfolio sample. A portfolio-hardening pass adds:

- explicit archived/non-hosted status;
- server-side logout so browser and server sessions are cleared together;
- service-only background-job access with database and worker ownership validation;
- stale worker-lock recovery;
- bounded AI-summary requests;
- stable client-facing error messages while preserving detailed server logs;
- unit tests for input validation and rate limiting;
- GitHub Actions lint/typecheck/test/build verification;
- migrations as the single authoritative database definition.

This remains a **code sample**, not a claim that a small take-home project has the same operational controls as a regulated or high-scale production service.

## Architecture

### Data model

- `games` — current state snapshot for fast dashboard reads.
- `quarters` — historical quarter ledger. Authenticated application users do not receive a delete policy.
- `jobs` — internal service queue for optional AI summaries; direct authenticated-client policies are intentionally absent.

### Server-authoritative state changes

The browser submits decisions to `POST /api/game/advance`. The route validates untrusted input and calls the transactional PostgreSQL function `advance_game`.

The database function:

1. locates and locks the authenticated user's game row;
2. normalizes the accepted input range;
3. computes the quarter result;
4. inserts one historical `quarters` row;
5. updates the current `games` snapshot;
6. uses uniqueness/locking semantics to reject duplicate concurrent advances.

This keeps the mutation authoritative on the server/database instead of trusting values computed by the client.

### Authentication

Supabase browser authentication is bridged into SSR-compatible HttpOnly cookies so server routes can authenticate requests. Logout also calls a server route before clearing the browser session, preventing the browser and server session stores from intentionally drifting apart.

### Row-level security

`games` and `quarters` use PostgreSQL RLS to constrain records to the authenticated user. The optional `jobs` table is treated as an internal service queue: background jobs are created and processed through server-side service-role code, while a hardening migration validates the `user_id` → `game_id` → `quarter_id` ownership chain.

### Background work

Optional AI summaries are queued separately from the authoritative game mutation. Failure to enqueue or generate a summary does not roll back the already-completed quarter.

The demo worker uses a conditional claim and records `locked_at` / `locked_by`. It also recovers stale `running` jobs after a bounded lease period. For a true multi-instance production workload, I would move claiming into a database function/queue primitive and use shared rate limiting/observability rather than this intentionally small implementation.

### Realtime UI

The UI can subscribe to Supabase Realtime changes and refresh from server-authoritative state. Realtime is a presentation/refresh mechanism, not the source of truth.

## Security boundaries

The repository intentionally distinguishes between client and privileged server capabilities:

- service-role credentials are loaded only in server modules;
- `.env.local` is ignored and the checked-in environment file contains placeholders only;
- debug logging avoids printing cookie/token values;
- background jobs are not directly writable by authenticated clients after the hardening migration;
- worker and AI endpoints require production controls before use;
- AI is disabled by default;
- request inputs are validated before state mutation;
- database RLS remains an enforcement layer even when application routes already scope queries.

If adapting this to a higher-risk production system, I would additionally use a shared/distributed rate limiter, managed queue/lease semantics, stronger end-to-end auth tests, dependency/security scanning, structured telemetry, and deployment-specific security headers at the application or edge layer.

## Verification

The repository includes a small automated verification contract:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Or run all four:

```bash
npm run verify
```

GitHub Actions executes the same verification on pushes and pull requests.

## Running locally

Requirements:

- Node.js 22+
- a Supabase project you control
- Supabase CLI if you want to apply the included migrations

Install and configure:

```bash
npm install
cp .env.local.example .env.local
# edit .env.local with your own Supabase project values
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase db push --include-all --yes
npm run dev
```

Windows users can also use the included PowerShell launch helper.

### Environment variables

Client-safe:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Server-only:

- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` — optional
- `WORKER_TOKEN` — required if the demo worker is exposed in a production-mode deployment

Feature flags:

- `ENABLE_AI` — defaults to disabled

Never reuse credentials from a historical deployment. Use keys from a Supabase project you control.

## API overview

Core:

- `POST /api/auth/session` — adopts browser auth into SSR cookies.
- `POST /api/auth/logout` — clears the server session/cookies.
- `GET /api/game` — returns the current snapshot, recent history, and derived insights.
- `POST /api/game/advance` — validates input and advances one quarter transactionally.
- `POST /api/game/reset` — starts a new run while preserving historical quarters.

Optional AI workflow:

- `POST /api/ai/notes` — generates/caches a summary for an owned quarter when AI is enabled.
- `POST /api/jobs/worker` — processes one queued summary job; intended as a demonstrator, not a hosted queue service.

## Design decisions worth reviewing

### Snapshot + ledger

`games` holds the current state while `quarters` preserves period history. This makes dashboard reads straightforward without sacrificing an auditable sequence of prior results.

### Transactional mutation

`advance_game` inserts history and updates the snapshot within one database transaction. A row lock plus a unique game/run/year/quarter key protects against duplicate concurrent advances.

### Defense in depth

Application routes authenticate and scope requests, while PostgreSQL RLS and relationship validation protect the persistence boundary. The service-role worker re-checks job ownership before using privileged access.

### Optional features stay optional

AI summary generation is feature-gated and asynchronous. Core simulation behavior does not depend on an external model provider.

## Intentional limitations

This is an archived portfolio project. Notable limitations are documented rather than hidden:

- the in-memory rate limiter is process-local and should be replaced by Redis/edge/shared storage for multi-instance deployments;
- the worker is a compact queue demonstrator rather than a managed distributed-job system;
- there is no active hosted demo;
- tests focus on high-value pure behavior rather than providing comprehensive browser/E2E coverage;
- deployment-specific headers and perimeter controls depend on the environment in which a clone is hosted.

## Repository purpose

This repository is public so a technical reviewer can inspect implementation choices without being given access to proprietary Lancaster Solutions codebases. More complex production architecture can be discussed separately through a controlled technical walkthrough.
