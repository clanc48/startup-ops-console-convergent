create extension if not exists pgcrypto;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  year int not null default 1,
  quarter int not null default 1,
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

-- Prevent duplicate quarter rows for the same game + period (protects against double-submit / multi-tab).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quarters_unique_game_period'
      and conrelid = 'public.quarters'::regclass
  ) then
    alter table public.quarters
      add constraint quarters_unique_game_period unique (game_id, year, quarter);
  end if;
end$$;

create index if not exists idx_quarters_game_created on public.quarters(game_id, created_at desc);
create index if not exists idx_quarters_integrity_hash on public.quarters(integrity_hash);

-- Simple jobs table to demonstrate queues/background processing
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
-- -----------------------------------------------------------------------------

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

-- quarters policies: user can access quarters only through their game
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

drop policy if exists quarters_delete on public.quarters;
create policy quarters_delete on public.quarters
  for delete using (
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
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Atomic advance (transaction) + optimistic locking
-- -----------------------------------------------------------------------------

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

  price numeric;
  new_eng int;
  new_sales int;
  salary_pct numeric;

  engineers_end int;
  sales_end int;

  quality_end int;
  demand numeric;
  units int;
  revenue numeric;
  payroll numeric;
  net_income numeric;
  hiring_cost numeric;
  cash_end numeric;

  next_year int;
  next_quarter int;

  is_over boolean := false;
  ended_reason text := null;

  integrity_payload text;
  integrity_hash text;
begin
  -- Lock the user's game row to prevent concurrent advances.
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

  -- Input normalization / validation
  price := greatest(0, p_price);
  new_eng := greatest(0, p_new_engineers);
  new_sales := greatest(0, p_new_sales);

  -- Match API validation (1-200).
  salary_pct := greatest(1, least(200, p_salary_pct));

  engineers_end := g.engineers + new_eng;
  sales_end := g.sales_staff + new_sales;

  -- Simulation model (per spec)
  quality_end := least(100, greatest(0, floor((g.quality + engineers_end * 0.5))::numeric))::int;
  demand := greatest(0, quality_end * 10 - price * 0.0001);
  units := floor(demand * sales_end * 0.5)::int;
  revenue := price * units;

  payroll := (engineers_end + sales_end) * 30000 * (salary_pct / 100);
  net_income := revenue - payroll;

  hiring_cost := (new_eng + new_sales) * 5000;
  cash_end := g.cash + net_income - hiring_cost;

  next_year := g.year;
  next_quarter := g.quarter + 1;
  if next_quarter > 4 then
    next_quarter := 1;
    next_year := next_year + 1;
  end if;

  if cash_end <= 0 then
    is_over := true;
    ended_reason := 'bankrupt';
  elsif (g.year = 10 and g.quarter = 4) then
    -- Win condition: successfully complete Y10Q4 with positive cash.
    is_over := true;
    ended_reason := 'won';
    -- Keep snapshot pinned for clarity.
    next_year := 10;
    next_quarter := 4;
  end if;

  -- Deterministic integrity payload (no secret): stable, verifiable hash
  integrity_payload := concat_ws('|',
    g.id, g.year, g.quarter,
    price, new_eng, new_sales, salary_pct,
    demand, units, revenue, payroll, net_income, cash_end, quality_end
  );
  integrity_hash := encode(digest(integrity_payload, 'sha256'), 'hex');

  begin
    insert into public.quarters (
      game_id, year, quarter,
      price, new_engineers, new_sales, salary_pct,
      demand, units, revenue, payroll, net_income, cash_end, quality_end,
      integrity_hash
    ) values (
      g.id, g.year, g.quarter,
      price, new_eng, new_sales, salary_pct,
      demand, units, revenue, payroll, net_income, cash_end, quality_end,
      integrity_hash
    ) returning * into q;
  exception
    when unique_violation then
      -- Duplicate period insert implies double-submit or concurrent advance.
      raise exception 'CONCURRENT_ADVANCE' using errcode = 'P0001';
  end;

  -- Optimistic lock: ensure we only advance once per period.
  update public.games
  set
    year = next_year,
    quarter = next_quarter,
    cash = cash_end,
    engineers = engineers_end,
    sales_staff = sales_end,
    quality = quality_end,
    is_over = is_over,
    ended_reason = ended_reason,
    updated_at = now()
  where id = g.id and year = g.year and quarter = g.quarter
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
