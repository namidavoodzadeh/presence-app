-- SRE sre-07: (1) one kill switch per AI feature, (2) the engine release on every ledger row.
-- (1) ai_switches: one row per feature, enabled by default. Setting enabled=false makes the ledger refuse every reserve for that
--     feature, so the call is never made: Talk saves the text and extracts nothing, Bridge answers "ai_off" and the app sends
--     as written. The risk floor does not use the ledger, so law 8 still holds with every switch off. Service role only.
--     Flip with next/scripts/ai_switch.py. Any lane may switch a feature off to stop harm (policy item 6); switching on is the owner's.
-- (2) usage_ledger.release: the deploy's git sha and date (next/api/lib/release_id.ts, stamped by deploy_api.py); model already
--     holds the model id the provider answered with. ledger_settle gets a five-argument sibling (the four-argument one stays, so the old API keeps working until the redeploy).
-- Rollback: drop table public.ai_switches; alter table public.usage_ledger drop column release;
--           drop function public.ledger_settle(uuid, bigint, text, text, text);
create table if not exists public.ai_switches (
  feature text primary key check (feature in ('talk','bridge','import','mirror')),
  enabled boolean not null default true,
  note text,
  changed_at timestamptz not null default now()
);
alter table public.ai_switches enable row level security;   -- no policy: service role only
insert into public.ai_switches (feature) values ('talk'), ('bridge'), ('import'), ('mirror') on conflict do nothing;

alter table public.usage_ledger add column if not exists release text;

create or replace function public.ledger_settle(p_id uuid, p_spent_micros bigint, p_model text, p_receipt text, p_release text)
returns void language sql security definer set search_path = public as $$
  update usage_ledger set spent_micros = least(p_spent_micros, reserved_micros), model = p_model, receipt = p_receipt,
    release = p_release, settled_at = now()
  where id = p_id and settled_at is null;
$$;
revoke all on function public.ledger_settle(uuid, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.ledger_settle(uuid, bigint, text, text, text) to service_role;
