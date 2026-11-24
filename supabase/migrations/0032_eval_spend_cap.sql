-- Q16 (a), CEO 13:15 PT 07 Nov: eval spend gets its own kind and its own daily cap, so the golden eval can never use
-- up the shared 3,000¢ a day that Nami's live use needs. A row whose kind starts with 'eval:' (the eval route and the
-- harnesses) counts only against the eval cap of 1,000¢ a UTC day; every other row counts only against the shared cap,
-- as before. The 20,000¢ total cap still counts every row. Until a row carries an 'eval:' kind nothing changes.
-- Rollback: re-run the ledger_reserve and ledger_snapshot definitions from 0001_app_v1.sql (no table or row changes).

create or replace function public.ledger_reserve(p_kind text, p_person uuid, p_worst_micros bigint, p_owner_preview boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare day date := (now() at time zone 'utc')::date;
        is_eval boolean := p_kind like 'eval:%';
        day_cap bigint := 3000 * 10000; total_cap bigint := 20000 * 10000;
        day_used bigint; total_used bigint; new_id uuid;
begin
  perform pg_advisory_xact_lock(7742);
  if is_eval then day_cap := 1000 * 10000;
  elsif p_owner_preview then day_cap := day_cap + 500 * 10000; end if;
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

-- today_cents is what counts toward the shared cap (eval rows apart); eval_today_cents and eval_daily_cap_cents are new.
create or replace function public.ledger_snapshot()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'utc_day', (now() at time zone 'utc')::date,
    'today_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and kind not like 'eval:%'), 0) / 10000.0),
    'owner_preview_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and owner_preview), 0) / 10000.0),
    'eval_today_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and kind like 'eval:%'), 0) / 10000.0),
    'total_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger), 0) / 10000.0),
    'daily_cap_cents', 3000, 'owner_preview_extra_cents', 500, 'eval_daily_cap_cents', 1000, 'total_cap_cents', 20000);
$$;
revoke all on function public.ledger_reserve(text, uuid, bigint, boolean) from public, anon, authenticated;
revoke all on function public.ledger_snapshot() from public, anon, authenticated;
