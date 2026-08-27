-- Portfolio hardening migration
-- The repository is archived/non-hosted, but this migration tightens trust boundaries
-- for anyone who clones and runs the sample.

-- Background jobs are an internal service queue. Authenticated browser clients do
-- not need direct CRUD access; server-side service-role code owns enqueue/processing.
drop policy if exists jobs_select on public.jobs;
drop policy if exists jobs_insert on public.jobs;
drop policy if exists jobs_update on public.jobs;
drop policy if exists jobs_delete on public.jobs;

-- The current application always creates fully-owned jobs. Make that contract
-- explicit at the database boundary.
alter table public.jobs alter column user_id set not null;
alter table public.jobs alter column game_id set not null;
alter table public.jobs alter column quarter_id set not null;

alter table public.jobs
  add constraint jobs_attempts_nonnegative check (attempts >= 0),
  add constraint jobs_max_attempts_positive check (max_attempts > 0),
  add constraint jobs_attempts_within_reasonable_bound check (max_attempts <= 20),
  add constraint jobs_known_status check (status in ('queued', 'running', 'done', 'failed')),
  add constraint jobs_known_type check (type in ('ai_summary'));

-- Ensure a privileged service cannot accidentally enqueue a job that associates
-- one user's identity with another user's game/quarter. This trigger runs even
-- when the service-role client bypasses RLS.
create or replace function public.validate_job_ownership()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.games g
    join public.quarters q on q.game_id = g.id
    where g.id = new.game_id
      and q.id = new.quarter_id
      and g.user_id = new.user_id
  ) then
    raise exception 'JOB_OWNERSHIP_MISMATCH' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists jobs_validate_ownership on public.jobs;
create trigger jobs_validate_ownership
before insert or update of user_id, game_id, quarter_id
on public.jobs
for each row execute function public.validate_job_ownership();
