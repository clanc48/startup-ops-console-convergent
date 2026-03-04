-- Canonical schema migration (consolidated)
-- This migration defines the authoritative schema for the take-home submission.
-- It consolidates earlier iterations into one clear baseline.

create extension if not exists pgcrypto;

create table if not exists public.games (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references auth.users(id) on delete cascade,
 year int not null default 1,
 quarter int not null default 1,
 run_no int not null default 1,
 -- Spec defaults
 cash numeric not null default 1000000,
 engineers int not null default 4,
 sales_staff int not null default 2,
 quality int not null default 50,
 is_over boolean not null default false,
 ended_reason text null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create index if not exists idx_games_user on public.games(user_id);

create table if not exists public.quarters (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 run_no int not null,
 year int not null,
 quarter int not null,

 price numeric not null,
 new_engineers int not null,
 new_sales int not null,
 salary_pct numeric not null,

 demand numeric not null,
 units int not null,
 revenue numeric not null,
 payroll numeric not null,
 net_income numeric not null,
 cash_end numeric not null,
 quality_end int not null,

 integrity_hash text null,
 ai_summary text null,

 created_at timestamptz not null default now()
);

-- Prevent duplicate quarter rows for the same game + run + period.
create unique index if not exists idx_quarters_unique_game_run_period
 on public.quarters(game_id, run_no, year, quarter);

create index if not exists idx_quarters_game_created on public.quarters(game_id, created_at desc);
create index if not exists idx_quarters_integrity_hash on public.quarters(integrity_hash);
create index if not exists idx_quarters_game_run on public.quarters(game_id, run_no, created_at desc);

-- Optional jobs table (AI summaries only)
create table if not exists public.jobs (
 id uuid primary key default gen_random_uuid(),
 type text not null,
 status text not null default 'queued',
 user_id uuid null references auth.users(id) on delete set null,
 game_id uuid null references public.games(id) on delete set null,
 quarter_id uuid null references public.quarters(id) on delete set null,
 payload jsonb not null default '{}'::jsonb,
 attempts int not null default 0,
 max_attempts int not null default 3,
 locked_at timestamptz null,
 locked_by text null,
 last_error text null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create index if not exists idx_jobs_status_created on public.jobs(status, created_at);
create index if not exists idx_jobs_type_status on public.jobs(type, status);
create index if not exists idx_jobs_game on public.jobs(game_id);

-- -----------------------------------------------------------------------------
-- Row Level Security (RLS)
-- ----------------------------------------------------------------------------

alter table public.games enable row level security;
alter table public.quarters enable row level security;
alter table public.jobs enable row level security;

-- games policies

drop policy if exists games_select on public.games;
create policy games_select on public.games
 for select using (user_id = auth.uid());

drop policy if exists games_insert on public.games;
create policy games_insert on public.games
 for insert with check (user_id = auth.uid());

drop policy if exists games_update on public.games;
create policy games_update on public.games
 for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists games_delete on public.games;
create policy games_delete on public.games
 for delete using (user_id = auth.uid());

-- quarters policies: user can access/insert quarters only through their game

drop policy if exists quarters_select on public.quarters;
create policy quarters_select on public.quarters
 for select using (
 exists (
 select 1 from public.games g
 where g.id = quarters.game_id and g.user_id = auth.uid()
 )
 );

drop policy if exists quarters_insert on public.quarters;
create policy quarters_insert on public.quarters
 for insert with check (
 exists (
 select 1 from public.games g
 where g.id = quarters.game_id and g.user_id = auth.uid()
 )
 );

-- jobs policies

drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs
 for select using (user_id = auth.uid());

drop policy if exists jobs_insert on public.jobs;
create policy jobs_insert on public.jobs
 for insert with check (user_id = auth.uid());

drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs
 for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists jobs_delete on public.jobs;
create policy jobs_delete on public.jobs
 for delete using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Atomic advance (transaction) + optimistic locking
-- Implements the prompt's math and constants (hire cost $5,000; salary $30,000/qtr)
-- ----------------------------------------------------------------------------

create or replace function public.advance_game(
 p_price numeric,
 p_new_engineers int,
 p_new_sales int,
 p_salary_pct numeric
)
returns table(game jsonb, quarter jsonb)
language plpgsql
set search_path = public
as $$
declare
 g public.games%rowtype;
 q public.quarters%rowtype;

 v_price numeric;
 v_new_eng int;
 v_new_sales int;
 v_salary_pct numeric;

 engineers_end int;
 sales_end int;

 quality_end int;
 demand numeric;
 units_sold int;
 revenue numeric;
 salary_cost_per_person numeric;
 total_payroll numeric;
 net_income numeric;
 hire_cost numeric;
 cash_end numeric;

 next_year int;
 next_quarter int;

 v_is_over boolean := false;
 v_ended_reason text := null;

 integrity_payload text;
 integrity_hash text;
begin
 select * into g
 from public.games
 where user_id = auth.uid()
 for update;

 if not found then
 raise exception 'GAME_NOT_FOUND' using errcode = 'P0002';
 end if;

 if g.is_over then
 raise exception 'GAME_OVER' using errcode = 'P0001';
 end if;

 v_price := greatest(0, p_price);
 v_new_eng := greatest(0, p_new_engineers);
 v_new_sales := greatest(0, p_new_sales);
 v_salary_pct := greatest(1, least(200, p_salary_pct));

 engineers_end := g.engineers + v_new_eng;
 sales_end := g.sales_staff + v_new_sales;

 quality_end := least(100, greatest(0, floor(g.quality + (engineers_end *0.5))::int));
 demand := greatest(0, (quality_end *10) - (v_price *0.0001));
 units_sold := floor(demand * sales_end *0.5)::int;
 revenue := v_price * units_sold;

 salary_cost_per_person := (v_salary_pct /100) *30000;
 total_payroll := salary_cost_per_person * (engineers_end + sales_end);
 net_income := revenue - total_payroll;

 cash_end := g.cash + net_income;
 hire_cost := (v_new_eng + v_new_sales) *5000;
 cash_end := cash_end - hire_cost;

 next_year := g.year;
 next_quarter := g.quarter +1;
 if next_quarter >4 then
 next_quarter :=1;
 next_year := next_year +1;
 end if;

 if cash_end <=0 then
 v_is_over := true;
 v_ended_reason := 'bankrupt';
 elsif (g.year =10 and g.quarter =4) and cash_end >0 then
 v_is_over := true;
 v_ended_reason := 'won';
 next_year :=10;
 next_quarter :=4;
 end if;

 integrity_payload := concat_ws('|',
 g.id, g.run_no, g.year, g.quarter,
 v_price, v_new_eng, v_new_sales, v_salary_pct,
 demand, units_sold, revenue, total_payroll, net_income, cash_end, quality_end
 );
 integrity_hash := encode(digest(integrity_payload, 'sha256'), 'hex');

 begin
 insert into public.quarters (
 game_id, run_no, year, quarter,
 price, new_engineers, new_sales, salary_pct,
 demand, units, revenue, payroll, net_income, cash_end, quality_end,
 integrity_hash
 ) values (
 g.id, g.run_no, g.year, g.quarter,
 v_price, v_new_eng, v_new_sales, v_salary_pct,
 demand, units_sold, revenue, total_payroll, net_income, cash_end, quality_end,
 integrity_hash
 ) returning * into q;
 exception
 when unique_violation then
 raise exception 'CONCURRENT_ADVANCE' using errcode = 'P0001';
 end;

 update public.games as g2
 set
 year = next_year,
 quarter = next_quarter,
 cash = cash_end,
 engineers = engineers_end,
 sales_staff = sales_end,
 quality = quality_end,
 is_over = v_is_over,
 ended_reason = v_ended_reason,
 updated_at = now()
 where g2.id = g.id and g2.run_no = g.run_no and g2.year = g.year and g2.quarter = g.quarter
 returning * into g;

 if not found then
 raise exception 'CONCURRENT_ADVANCE' using errcode = 'P0001';
 end if;

 return query
 select to_jsonb(g), to_jsonb(q);
end;
$$;

revoke all on function public.advance_game(
 numeric, int, int, numeric
) from public;

grant execute on function public.advance_game(
 numeric, int, int, numeric
) to authenticated;
