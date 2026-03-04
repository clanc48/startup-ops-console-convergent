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

 created_at timestamptz not null default now()
);

-- Prevent duplicate quarter rows for the same game + run + period.
do $$
begin
 if not exists (
 select 1 from pg_constraint
 where conname = 'quarters_unique_game_run_period'
 and conrelid = 'public.quarters'::regclass
 ) then
 alter table public.quarters
 add constraint quarters_unique_game_run_period unique (game_id, run_no, year, quarter);
 end if;
end$$;

create index if not exists idx_quarters_game_created on public.quarters(game_id, created_at desc);
create index if not exists idx_quarters_integrity_hash on public.quarters(integrity_hash);
create index if not exists idx_quarters_game_run on public.quarters(game_id, run_no, created_at desc);

-- -----------------------------------------------------------------------------
-- Row Level Security (RLS)
-- -----------------------------------------------------------------------------

alter table public.games enable row level security;
alter table public.quarters enable row level security;

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

-- NOTE: no `quarters_delete` policy.
-- This keeps the quarters ledger append-only from the perspective of an authenticated user.

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
set search_path = public, extensions
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

 -- Input normalization
 v_price := greatest(0, p_price);
 v_new_eng := greatest(0, p_new_engineers);
 v_new_sales := greatest(0, p_new_sales);
 v_salary_pct := greatest(1, least(200, p_salary_pct));

 engineers_end := g.engineers + v_new_eng;
 sales_end := g.sales_staff + v_new_sales;

 -- Prompt model:
 -- quality += engineers*0.5 (cap100)
 -- demand = quality*10 - price*0.0001 (floor0)
 -- units = demand*sales_staff*0.5 (integer)
 -- revenue = price*units
 -- payroll = (salary_pct/100*30000)*(engineers+sales)
 -- net = revenue - payroll
 -- cash_end = cash + net - new_hires*5000

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

 -- Advance quarter counters (snapshot)
 next_year := g.year;
 next_quarter := g.quarter +1;
 if next_quarter >4 then
 next_quarter :=1;
 next_year := next_year +1;
 end if;

 -- Lose: when a quarter ends with cash_end <=0
 if cash_end <=0 then
 v_is_over := true;
 v_ended_reason := 'bankrupt';
 -- Win: when you complete Y10 Q4 with cash_end >0
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
