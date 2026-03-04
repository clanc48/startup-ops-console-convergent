-- Add staff_events ledger to make staffing totals authoritative (incl. removals)

create table if not exists public.staff_events (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 run_no int not null,
 year int not null,
 quarter int not null,
 delta_engineers int not null default0,
 delta_sales int not null default0,
 reason text null,
 created_at timestamptz not null default now()
);

create index if not exists idx_staff_events_game_run_created
 on public.staff_events(game_id, run_no, created_at desc);

alter table public.staff_events enable row level security;

drop policy if exists staff_events_select on public.staff_events;
create policy staff_events_select on public.staff_events
 for select using (
 exists (
 select1 from public.games g
 where g.id = staff_events.game_id and g.user_id = auth.uid()
 )
 );

drop policy if exists staff_events_insert on public.staff_events;
create policy staff_events_insert on public.staff_events
 for insert with check (
 exists (
 select1 from public.games g
 where g.id = staff_events.game_id and g.user_id = auth.uid()
 )
 );
