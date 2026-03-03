-- Fix ambiguous column reference "is_over" (and similar) in advance_game.
-- PL/pgSQL name resolution can treat unqualified identifiers as either variables or columns.
-- This migration redefines the function using distinct variable names and fully-qualified updates.

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

 -- Input normalization / validation
 price := greatest(0, p_price);
 new_eng := greatest(0, p_new_engineers);
 new_sales := greatest(0, p_new_sales);

 -- Match API validation (1-200).
 salary_pct := greatest(1, least(200, p_salary_pct));

 engineers_end := g.engineers + new_eng;
 sales_end := g.sales_staff + new_sales;

 -- Simulation model (per spec)
 quality_end := least(100, greatest(0, floor((g.quality + engineers_end *0.5))::numeric))::int;
 demand := greatest(0, quality_end *10 - price *0.0001);
 units := floor(demand * sales_end *0.5)::int;
 revenue := price * units;

 payroll := (engineers_end + sales_end) *30000 * (salary_pct /100);
 net_income := revenue - payroll;

 hiring_cost := (new_eng + new_sales) *5000;
 cash_end := g.cash + net_income - hiring_cost;

 next_year := g.year;
 next_quarter := g.quarter +1;
 if next_quarter >4 then
 next_quarter :=1;
 next_year := next_year +1;
 end if;

 if cash_end <=0 then
 v_is_over := true;
 v_ended_reason := 'bankrupt';
 elsif (g.year =10 and g.quarter =4) then
 -- Win condition: successfully complete Y10Q4 with positive cash.
 v_is_over := true;
 v_ended_reason := 'won';
 next_year :=10;
 next_quarter :=4;
 end if;

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
 where g2.id = g.id and g2.year = g.year and g2.quarter = g.quarter
 returning * into g;

 if not found then
 raise exception 'CONCURRENT_ADVANCE' using errcode = 'P0001';
 end if;

 return query
 select to_jsonb(g), to_jsonb(q);
end;
$$;
