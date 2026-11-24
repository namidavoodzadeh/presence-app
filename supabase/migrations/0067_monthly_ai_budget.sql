-- Monthly AI budget in place of the lifetime cap (docs/ops/AI-BUDGET-PROPOSAL.md; COO 15:25Z 15 Nov). STAGING FIRST. Hosted waits for Nami's yes and his figure.
-- (1) One row, ai_budget(monthly_cap_cents, warn_pct_1, warn_pct_2). The amount is a setting: change it with one update, no deploy. The seeded
--     figure is the neutral option from the proposal (20,000¢ a month, the old lifetime number made monthly); Nami's figure replaces it.
-- (2) ledger_reserve sums the current UTC month of live use (every kind except eval:*) instead of every row ever written, and refuses with
--     month_limit and opens_at = the 1st of next month 00:00 UTC. Eval spend keeps its own 1,000¢ day cap and is not counted against the month.
--     The 3,000¢ day cap, the 300¢ person allowance (+500¢ for the owner preview) and the eval cap are unchanged.
-- (3) ledger_snapshot keeps every old key and adds month_cents, month_cap_cents, month_pct, level (ok | warn | high) and month_opens_at.
--     total_cents stays (lifetime spend, information only); total_cap_cents becomes null because nothing enforces a lifetime cap now.
-- Rollback: re-run ledger_reserve and ledger_snapshot from 0033_person_daily_allowance.sql (the lifetime 20,000¢ cap returns at once).
--           drop table public.ai_budget is optional and harmless to leave.

create table if not exists public.ai_budget (
  id boolean primary key default true check (id),
  monthly_cap_cents integer not null default 20000 check (monthly_cap_cents > 0),
  warn_pct_1 integer not null default 50 check (warn_pct_1 between 1 and 99),
  warn_pct_2 integer not null default 80 check (warn_pct_2 between 1 and 99),
  updated_at timestamptz not null default now(),
  check (warn_pct_1 < warn_pct_2)
);
alter table public.ai_budget enable row level security;
revoke all on public.ai_budget from public, anon, authenticated;
insert into public.ai_budget (id) values (true) on conflict (id) do nothing;

create index if not exists usage_ledger_day_idx on public.usage_ledger(utc_day);

create or replace function public.ledger_reserve(p_kind text, p_person uuid, p_worst_micros bigint, p_owner_preview boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare day date := (now() at time zone 'utc')::date;
        month_start date := date_trunc('month', (now() at time zone 'utc'))::date;
        is_eval boolean := p_kind like 'eval:%';
        day_cap bigint := 3000 * 10000; month_cap bigint;
        person_cap bigint := 300 * 10000;
        day_used bigint; month_used bigint := 0; person_used bigint; new_id uuid;
begin
  select monthly_cap_cents::bigint * 10000 into month_cap from ai_budget where id;
  if month_cap is null then month_cap := 20000::bigint * 10000; end if;
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
  if not is_eval then
    select coalesce(sum(coalesce(spent_micros, reserved_micros)), 0) into month_used from usage_ledger
     where utc_day >= month_start and kind not like 'eval:%';
  end if;
  if day_used + p_worst_micros > day_cap then
    return jsonb_build_object('ok', false, 'error', 'daily_limit', 'day_used_micros', day_used, 'day_cap_micros', day_cap,
                              'scope', case when is_eval then 'eval' else 'shared' end,
                              'opens_at', ((day + 1)::timestamp at time zone 'utc'));
  end if;
  if not is_eval and month_used + p_worst_micros > month_cap then
    return jsonb_build_object('ok', false, 'error', 'month_limit', 'month_used_micros', month_used, 'month_cap_micros', month_cap,
                              'opens_at', ((month_start + interval '1 month')::timestamp at time zone 'utc'));
  end if;
  insert into usage_ledger (utc_day, kind, person, owner_preview, reserved_micros) values (day, p_kind, p_person, p_owner_preview, p_worst_micros)
    returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'day_used_micros', day_used, 'day_cap_micros', day_cap, 'month_used_micros', month_used);
end $$;

create or replace function public.ledger_snapshot()
returns jsonb language sql security definer set search_path = public as $$
  with b as (select coalesce((select monthly_cap_cents from ai_budget where id), 20000) as cap,
                    coalesce((select warn_pct_1 from ai_budget where id), 50) as w1,
                    coalesce((select warn_pct_2 from ai_budget where id), 80) as w2),
  m as (select ceil(coalesce(sum(coalesce(spent_micros, reserved_micros)), 0) / 10000.0) as cents from usage_ledger
         where utc_day >= date_trunc('month', (now() at time zone 'utc'))::date and kind not like 'eval:%')
  select jsonb_build_object(
    'utc_day', (now() at time zone 'utc')::date,
    'today_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and kind not like 'eval:%'), 0) / 10000.0),
    'owner_preview_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and owner_preview), 0) / 10000.0),
    'eval_today_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and kind like 'eval:%'), 0) / 10000.0),
    'total_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger), 0) / 10000.0),
    'daily_cap_cents', 3000, 'owner_preview_extra_cents', 500, 'eval_daily_cap_cents', 1000, 'total_cap_cents', null,
    'person_daily_allowance_cents', 300,
    'month_cents', (select cents from m), 'month_cap_cents', (select cap from b),
    'month_pct', round((select cents from m) * 100.0 / (select cap from b), 1),
    'level', case when (select cents from m) * 100.0 >= (select cap from b) * (select w2 from b) then 'high'
                  when (select cents from m) * 100.0 >= (select cap from b) * (select w1 from b) then 'warn' else 'ok' end,
    'month_opens_at', ((date_trunc('month', (now() at time zone 'utc'))::date + interval '1 month')::timestamp at time zone 'utc'));
$$;
revoke all on function public.ledger_reserve(text, uuid, bigint, boolean) from public, anon, authenticated;
revoke all on function public.ledger_snapshot() from public, anon, authenticated;
