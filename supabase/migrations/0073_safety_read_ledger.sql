-- QA-B336 / COO 03:20Z 16 Nov (Q-ENG-B336-FAILCLOSED-1 (3)). The one safety entry fails closed, so a safety read that is refused
-- becomes a crisis screen. A person who has used their 300¢ day must never get that screen for every line they write. So:
--   (1) a safety read (ledger kind 'safety_read', written by the model client for purpose "safety") is NOT counted against the
--       person's 300¢ allowance and NOT against the shared 3,000¢ day cap. It is written to usage_ledger under its own kind.
--   (2) one global daily ceiling for safety reads, 300¢ a UTC day (about 1,500 to 2,000 reads at 0.15 to 0.2¢; staging measured 53
--       safety readings in the busiest 7 days, docs/ops/AI-COST.md). Past it a reserve is refused with error 'safety_ceiling'
--       and the client reports the reading unavailable, which stops with the resources (fails closed). Nothing passes unread.
--   (3) the credit cycle (0068: 19,000¢ real cost, one pool, safety reads included) still applies: credits only, no overflow spend; it also fails closed.
-- Everything else in ledger_reserve and ledger_snapshot is 0068, unchanged. ledger_snapshot excludes safety reads from today_cents and
-- owner_preview_cents and adds safety_today_cents and safety_daily_ceiling_cents. Re-based on 0068 (17 Nov): the first version of this file
-- was built on 0033 and would have replaced the credit-cycle ledger; apply AFTER 0067 and 0068.
-- Rollback: re-run ledger_reserve and ledger_snapshot from 0068_ai_credit_cycle.sql (a safety_read row is then an ordinary row).

create or replace function public.ledger_reserve(p_kind text, p_person uuid, p_worst_micros bigint, p_owner_preview boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare day date := (now() at time zone 'utc')::date;
        month_start date := public.ai_cycle_start(day);
        is_eval boolean := p_kind like 'eval:%';
        is_safety boolean := p_kind = 'safety_read';
        day_cap bigint := 3000 * 10000; month_cap bigint;
        person_cap bigint := 300 * 10000;
        safety_ceiling bigint := 300 * 10000;
        day_used bigint; month_used bigint := 0; person_used bigint; safety_used bigint; new_id uuid;
begin
  select monthly_cap_cents::bigint * 10000 into month_cap from ai_budget where id;
  if month_cap is null then month_cap := 19000::bigint * 10000; end if;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_person::text, 'kind:' || p_kind), 7742));
  if is_eval then day_cap := 1000 * 10000;
  elsif p_owner_preview then day_cap := day_cap + 500 * 10000; person_cap := person_cap + 500 * 10000; end if;
  -- SAFETY: one global ceiling, no personal allowance, no shared day cap. The credit cycle (month) still applies: credits only, no overflow spend.
  if is_safety then
    perform pg_advisory_xact_lock(hashtextextended('kind:safety_read', 7743));
    select coalesce(sum(coalesce(spent_micros, reserved_micros)), 0) into safety_used from usage_ledger
     where utc_day = day and kind = 'safety_read';
    if safety_used + p_worst_micros > safety_ceiling then
      return jsonb_build_object('ok', false, 'error', 'safety_ceiling', 'scope', 'safety', 'day_used_micros', safety_used,
                                'day_cap_micros', safety_ceiling, 'opens_at', ((day + 1)::timestamp at time zone 'utc'));
    end if;
  end if;
  if p_person is not null and not is_eval and not is_safety then
    select coalesce(sum(coalesce(spent_micros, reserved_micros)), 0) into person_used from usage_ledger
     where utc_day = day and person = p_person and kind not like 'eval:%' and kind <> 'safety_read';
    if person_used + p_worst_micros > person_cap then
      return jsonb_build_object('ok', false, 'error', 'daily_limit', 'scope', 'person', 'day_used_micros', person_used,
                                'day_cap_micros', person_cap, 'opens_at', ((day + 1)::timestamp at time zone 'utc'));
    end if;
  end if;
  select coalesce(sum(coalesce(spent_micros, reserved_micros)), 0) into day_used from usage_ledger
   where utc_day = day and (kind like 'eval:%') = is_eval and kind <> 'safety_read';
  select coalesce(sum(coalesce(spent_micros, reserved_micros)), 0) into month_used from usage_ledger
   where utc_day >= month_start;                                           -- every kind: the credit is one pool
  if not is_safety and day_used + p_worst_micros > day_cap then
    return jsonb_build_object('ok', false, 'error', 'daily_limit', 'day_used_micros', day_used, 'day_cap_micros', day_cap,
                              'scope', case when is_eval then 'eval' else 'shared' end,
                              'opens_at', ((day + 1)::timestamp at time zone 'utc'));
  end if;
  if month_used + p_worst_micros > month_cap then
    return jsonb_build_object('ok', false, 'error', 'month_limit', 'month_used_micros', month_used, 'month_cap_micros', month_cap,
                              'opens_at', ((month_start + interval '1 month')::date::timestamp at time zone 'utc'));
  end if;
  insert into usage_ledger (utc_day, kind, person, owner_preview, reserved_micros) values (day, p_kind, p_person, p_owner_preview, p_worst_micros)
    returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'day_used_micros', day_used, 'day_cap_micros', day_cap, 'month_used_micros', month_used);
end $$;

create or replace function public.ledger_snapshot()
returns jsonb language sql security definer set search_path = public as $$
  with b as (select coalesce((select monthly_cap_cents from ai_budget where id), 19000) as cap,
                    coalesce((select warn_pct_1 from ai_budget where id), 50) as w1,
                    coalesce((select warn_pct_2 from ai_budget where id), 80) as w2,
                    coalesce((select warn_pct_3 from ai_budget where id), 95) as w3,
                    public.ai_cycle_start() as start),
  m as (select coalesce(sum(coalesce(spent_micros, reserved_micros)), 0) as micros,
               coalesce(sum(coalesce(spent_micros, reserved_micros)) filter (where kind like 'eval:%'), 0) as eval_micros
          from usage_ledger where utc_day >= (select start from b))
  select jsonb_build_object(
    'utc_day', (now() at time zone 'utc')::date,
    'today_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and kind not like 'eval:%' and kind <> 'safety_read'), 0) / 10000.0),
    'owner_preview_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and owner_preview and kind <> 'safety_read'), 0) / 10000.0),
    'safety_today_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and kind = 'safety_read'), 0) / 10000.0),
    'eval_today_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and kind like 'eval:%'), 0) / 10000.0),
    'total_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger), 0) / 10000.0),
    'daily_cap_cents', 3000, 'owner_preview_extra_cents', 500, 'eval_daily_cap_cents', 1000, 'total_cap_cents', null,
    'person_daily_allowance_cents', 300, 'safety_daily_ceiling_cents', 300,
    'month_cents', ceil((select micros from m) / 10000.0), 'month_eval_cents', ceil((select eval_micros from m) / 10000.0),
    'month_cap_cents', (select cap from b),
    'month_pct', round((select micros from m) / 10000.0 * 100.0 / (select cap from b), 1),
    'level', case when (select micros from m) / 10000.0 * 100.0 >= (select cap from b) * (select w3 from b) then 'critical'
                  when (select micros from m) / 10000.0 * 100.0 >= (select cap from b) * (select w2 from b) then 'high'
                  when (select micros from m) / 10000.0 * 100.0 >= (select cap from b) * (select w1 from b) then 'warn' else 'ok' end,
    'cycle_starts_at', ((select start from b)::timestamp at time zone 'utc'),
    'month_opens_at', (((select start from b) + interval '1 month')::date::timestamp at time zone 'utc'));
$$;
revoke all on function public.ledger_reserve(text, uuid, bigint, boolean) from public, anon, authenticated;
revoke all on function public.ledger_snapshot() from public, anon, authenticated;
