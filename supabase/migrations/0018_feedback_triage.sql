-- Cloud feedback triage (R8) is additive and remains off until PRESENCE_CLOUD_TRIAGE=true.
-- The worker role has no login/deploy authority and receives no access outside this queue.
alter table public.feedback
  add column if not exists triage_status text not null default 'new',
  add column if not exists severity text,
  add column if not exists area text,
  add column if not exists dedupe_key text,
  add column if not exists bug_id text,
  add column if not exists lane text,
  add column if not exists triaged_at timestamptz;

alter table public.feedback drop constraint if exists feedback_triage_status_check;
alter table public.feedback add constraint feedback_triage_status_check
  check (triage_status in ('new', 'triaged'));
alter table public.feedback drop constraint if exists feedback_severity_check;
alter table public.feedback add constraint feedback_severity_check
  check (severity is null or severity in ('P0', 'P1', 'P2', 'P3'));
alter table public.feedback drop constraint if exists feedback_lane_check;
alter table public.feedback add constraint feedback_lane_check
  check (lane is null or lane in ('app', 'app2', 'engine', 'qa'));
alter table public.feedback drop constraint if exists feedback_triage_complete_check;
alter table public.feedback add constraint feedback_triage_complete_check check (
  (triage_status = 'new' and severity is null and area is null and dedupe_key is null
    and bug_id is null and lane is null and triaged_at is null)
  or
  (triage_status = 'triaged' and severity is not null and area is not null
    and dedupe_key is not null and bug_id is not null and lane is not null and triaged_at is not null)
);

create index if not exists feedback_triage_status_created_idx
  on public.feedback (triage_status, created_at);
create index if not exists feedback_dedupe_key_idx
  on public.feedback (dedupe_key) where triage_status = 'triaged';

create or replace view public.triage_queue with (security_invoker = true) as
select id, report_id, body, screenshot_path, created_at
from public.feedback
where triage_status = 'new';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'feedback_triage_worker') then
    create role feedback_triage_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$$;

-- Postgres 16+ no longer makes the creating role a member of a role it creates, so without this
-- the later `alter function ... owner to feedback_triage_worker` fails with "must be able to SET
-- ROLE" (hit live against hosted, which runs Postgres 17). Membership, not CREATEROLE, is what
-- SET ROLE checks.
grant feedback_triage_worker to current_user;

revoke all on all tables in schema public from feedback_triage_worker;
revoke all on all sequences in schema public from feedback_triage_worker;
revoke all on all functions in schema public from feedback_triage_worker;
grant usage on schema public to feedback_triage_worker;
grant select on public.feedback to feedback_triage_worker;
grant update (triage_status, severity, area, dedupe_key, bug_id, lane, triaged_at)
  on public.feedback to feedback_triage_worker;
grant select on public.triage_queue to feedback_triage_worker;

drop policy if exists feedback_triage_worker_read on public.feedback;
create policy feedback_triage_worker_read on public.feedback
  for select to feedback_triage_worker using (true);
drop policy if exists feedback_triage_worker_update on public.feedback;
create policy feedback_triage_worker_update on public.feedback
  for update to feedback_triage_worker using (true) with check (
    triage_status = 'triaged'
    and severity in ('P0', 'P1', 'P2', 'P3')
    and area is not null
    and dedupe_key is not null
    and bug_id is not null
    and lane in ('app', 'app2', 'engine', 'qa')
    and triaged_at is not null
  );

-- PostgREST keeps the service key at the RPC boundary. The functions themselves run
-- as the restricted worker, so feedback access is still constrained by the grants
-- and RLS policies above instead of inheriting service_role's table-wide access.
create or replace function public.feedback_triage_new()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', id,
    'report_id', report_id,
    'body', body,
    'created_at', created_at
  )
  from public.feedback
  where triage_status = 'new'
  order by created_at;
$$;

create or replace function public.feedback_triage_history(p_limit integer default 500)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', id,
    'report_id', report_id,
    'body', body,
    'created_at', created_at,
    'dedupe_key', dedupe_key,
    'bug_id', bug_id
  )
  from public.feedback
  where triage_status = 'triaged'
  order by triaged_at desc
  limit least(greatest(p_limit, 0), 500);
$$;

create or replace function public.feedback_triage_mark(
  p_id uuid,
  p_severity text,
  p_area text,
  p_dedupe_key text,
  p_bug_id text,
  p_lane text,
  p_triaged_at timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  changed uuid;
begin
  update public.feedback set
    triage_status = 'triaged',
    severity = p_severity,
    area = p_area,
    dedupe_key = p_dedupe_key,
    bug_id = p_bug_id,
    lane = p_lane,
    triaged_at = p_triaged_at
  where id = p_id and triage_status = 'new'
  returning id into changed;
  if changed is null then
    raise exception 'feedback update lost race: %', p_id;
  end if;
  return changed;
end;
$$;

-- Transferring ownership also requires the new owner to hold CREATE on the function's schema
-- (Postgres checks the new owner could have created the object there); grant it only for this
-- transfer, then take it back so the worker keeps no standing schema-level privilege.
grant create on schema public to feedback_triage_worker;
alter function public.feedback_triage_new() owner to feedback_triage_worker;
alter function public.feedback_triage_history(integer) owner to feedback_triage_worker;
alter function public.feedback_triage_mark(uuid,text,text,text,text,text,timestamptz) owner to feedback_triage_worker;
revoke create on schema public from feedback_triage_worker;

revoke all on function public.feedback_triage_new() from public, anon, authenticated;
revoke all on function public.feedback_triage_history(integer) from public, anon, authenticated;
revoke all on function public.feedback_triage_mark(uuid,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.feedback_triage_new() to service_role;
grant execute on function public.feedback_triage_history(integer) to service_role;
grant execute on function public.feedback_triage_mark(uuid,text,text,text,text,text,timestamptz) to service_role;

revoke all on public.triage_queue from public, anon, authenticated;
