-- AI credit cycle (CEO 11:00 PT 15 Nov, Nami: "keep it to the $200 credit"). Supersedes the calendar-month window of 0067 before either is applied
-- anywhere. STAGING FIRST; hosted only on the CEO's go.
-- (1) The budget is one cycle that starts on the credit date: ai_budget.reset_day (25 = Anthropic credit refresh, the 25th UTC), cap 19,000 cents REAL
--     cost (95 per cent of the $200 credit; the other 1,000 cents are the margin for calls in flight and for the other database's spend). The amount and the day are settings: one update, no deploy.
-- (2) The cycle counts EVERY row, evals included: the credit is one pool and the evals draw on it. An eval keeps its own 1,000-cent day cap and is
--     refused too once the cycle is spent ("no overflow spend"). Live traffic is still protected by the 3,000-cent day cap and the person allowance.
-- (3) Rows are settled at exact cost (spent_micros, 1/10,000 of a cent; the client now settles fractions, not a rounded-up whole cent), so the sum
--     is the provider's bill, not about twice it. Reserved-and-unsettled rows still count at their worst case until settled.
-- (4) Warning levels at 50 / 80 / 95 per cent of the cap: ledger_snapshot().level is ok | warn | high | critical. next/scripts/ai_budget_alert.py
--     reads it hourly and writes one alerts.jsonl row per level per cycle.
-- Rollback: re-run ledger_reserve and ledger_snapshot from 0033_person_daily_allowance.sql (the lifetime 20,000-cent cap returns at once).
--           The ai_budget table and its columns are harmless to leave.

create table if not exists public.ai_budget (
  id boolean primary key default true check (id),
  monthly_cap_cents integer not null default 19000 check (monthly_cap_cents > 0),
  warn_pct_1 integer not null default 50 check (warn_pct_1 between 1 and 99),
  warn_pct_2 integer not null default 80 check (warn_pct_2 between 1 and 99),
  updated_at timestamptz not null default now(),
  check (warn_pct_1 < warn_pct_2)
);
alter table public.ai_budget enable row level security;
revoke all on public.ai_budget from public, anon, authenticated;
alter table public.ai_budget add column if not exists reset_day integer not null default 25 check (reset_day between 1 and 28);
alter table public.ai_budget add column if not exists warn_pct_3 integer not null default 95 check (warn_pct_3 between 1 and 99);
alter table public.ai_budget alter column monthly_cap_cents set default 19000;
insert into public.ai_budget (id, monthly_cap_cents) values (true, 19000) on conflict (id) do nothing;
-- 0067's seeded figure (20,000) was never Nami's; the CEO's figure replaces it. A figure anyone set by hand is left alone.
update public.ai_budget set monthly_cap_cents = 19000 where id and monthly_cap_cents = 20000;

create index if not exists usage_ledger_day_idx on public.usage_ledger(utc_day);

-- The first day of the current credit cycle: the latest reset_day on or before today (UTC).
create or replace function public.ai_cycle_start(p_today date default (now() at time zone 'utc')::date)
returns date language sql stable set search_path = public as $$
  with r as (select coalesce((select reset_day from ai_budget where id), 25) as d)
  select case when extract(day from p_today)::int >= (select d from r)
              then (date_trunc('month', p_today)::date + ((select d from r) - 1))
              else ((date_trunc('month', p_today) - interval '1 month')::date + ((select d from r) - 1)) end;
$$;
revoke all on function public.ai_cycle_start(date) from public, anon, authenticated;

create or replace function public.ledger_reserve(p_kind text, p_person uuid, p_worst_micros bigint, p_owner_preview boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare day date := (now() at time zone 'utc')::date;
        month_start date := public.ai_cycle_start(day);
        is_eval boolean := p_kind like 'eval:%';
        day_cap bigint := 3000 * 10000; month_cap bigint;
        person_cap bigint := 300 * 10000;
        day_used bigint; month_used bigint := 0; person_used bigint; new_id uuid;
begin
  select monthly_cap_cents::bigint * 10000 into month_cap from ai_budget where id;
  if month_cap is null then month_cap := 19000::bigint * 10000; end if;
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
  select coalesce(sum(coalesce(spent_micros, reserved_micros)), 0) into month_used from usage_ledger
   where utc_day >= month_start;                                           -- every kind: the credit is one pool
  if day_used + p_worst_micros > day_cap then
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
    'today_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and kind not like 'eval:%'), 0) / 10000.0),
    'owner_preview_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and owner_preview), 0) / 10000.0),
    'eval_today_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and kind like 'eval:%'), 0) / 10000.0),
    'total_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger), 0) / 10000.0),
    'daily_cap_cents', 3000, 'owner_preview_extra_cents', 500, 'eval_daily_cap_cents', 1000, 'total_cap_cents', null,
    'person_daily_allowance_cents', 300,
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
