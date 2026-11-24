-- System design item 5 (engine NEXT 3). Two changes to ledger_reserve, no table or row changes.
-- (1) A daily AI allowance per person: 300¢ a UTC day of live use for each person (the owner's preview account gets its +500¢
--     on top). One person using the app hard cannot use up the day for everyone else. Rows with no person (agents, evals, the
--     system) have no personal allowance. The shared 3,000¢ day cap and the 20,000¢ total stay as the safety net.
-- (2) The one global advisory lock (7742) is gone. Reserve now takes a lock per person (or one per kind for person-less rows),
--     so two people's calls never queue behind each other. The safety-net sums are read without a global lock: with N calls in
--     flight at the same instant the day total can pass its cap by at most their worst cases, which the per-person allowance
--     already bounds. That is the trade for not serialising every model call.
-- Rollback: re-run ledger_reserve and ledger_snapshot from 0032_eval_spend_cap.sql.

create index if not exists usage_ledger_day_person_idx on public.usage_ledger(utc_day, person);

create or replace function public.ledger_reserve(p_kind text, p_person uuid, p_worst_micros bigint, p_owner_preview boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare day date := (now() at time zone 'utc')::date;
        is_eval boolean := p_kind like 'eval:%';
        day_cap bigint := 3000 * 10000; total_cap bigint := 20000 * 10000;
        person_cap bigint := 300 * 10000;
        day_used bigint; total_used bigint; person_used bigint; new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_person::text, 'kind:' || p_kind), 7742));
  if is_eval then day_cap := 1000 * 10000;
  elsif p_owner_preview then day_cap := day_cap + 500 * 10000; person_cap := person_cap + 500 * 10000; end if;
  if p_person is not null and not is_eval then
    select coalesce(sum(coalesce(spent_micros, reserved_micros)), 0) into person_used from usage_ledger
     where utc_day = day and person = p_person and kind not like 'eval:%';
    if person_used + p_worst_micros > person_cap then
      return jsonb_build_object('ok', false, 'error', 'daily_limit', 'scope', 'person', 'day_used_micros', person_used,
                                'day_cap_micros', person_cap, 'opens_at', ((day + 1)::timestamp at time zone 'utc'));
    end if;
  end if;
  select coalesce(sum(coalesce(spent_micros, reserved_micros)), 0) into day_used from usage_ledger
   where utc_day = day and (kind like 'eval:%') = is_eval;
  select coalesce(sum(coalesce(spent_micros, reserved_micros)), 0) into total_used from usage_ledger;
  if day_used + p_worst_micros > day_cap then
    return jsonb_build_object('ok', false, 'error', 'daily_limit', 'day_used_micros', day_used, 'day_cap_micros', day_cap,
                              'scope', case when is_eval then 'eval' else 'shared' end,
                              'opens_at', ((day + 1)::timestamp at time zone 'utc'));
  end if;
  if total_used + p_worst_micros > total_cap then
    return jsonb_build_object('ok', false, 'error', 'total_limit', 'total_used_micros', total_used, 'total_cap_micros', total_cap);
  end if;
  insert into usage_ledger (utc_day, kind, person, owner_preview, reserved_micros) values (day, p_kind, p_person, p_owner_preview, p_worst_micros)
    returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'day_used_micros', day_used, 'day_cap_micros', day_cap, 'total_used_micros', total_used);
end $$;

create or replace function public.ledger_snapshot()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'utc_day', (now() at time zone 'utc')::date,
    'today_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and kind not like 'eval:%'), 0) / 10000.0),
    'owner_preview_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and owner_preview), 0) / 10000.0),
    'eval_today_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and kind like 'eval:%'), 0) / 10000.0),
    'total_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger), 0) / 10000.0),
    'daily_cap_cents', 3000, 'owner_preview_extra_cents', 500, 'eval_daily_cap_cents', 1000, 'total_cap_cents', 20000,
    'person_daily_allowance_cents', 300);
$$;
revoke all on function public.ledger_reserve(text, uuid, bigint, boolean) from public, anon, authenticated;
revoke all on function public.ledger_snapshot() from public, anon, authenticated;
