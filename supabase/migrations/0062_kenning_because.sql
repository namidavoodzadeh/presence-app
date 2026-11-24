-- V3 kenning map, heard 'because' ask (CPO KM-W3; app Q-APP-KM-2). Additive. STAGING ONLY until Nami's yes.
-- One row per pair the person said in their own words ("X because Y"): "for me, a comes from b". The ask is derived from these rows,
-- one ask per pair; 'Not now' is stored here so it never asks again for that pair. No words are stored here (ids only).
create table if not exists public.kenning_because (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  a_belief uuid not null references public.beliefs(id) on delete cascade,
  b_belief uuid not null references public.beliefs(id) on delete cascade,
  declined boolean not null default false,
  created_at timestamptz not null default now(),
  check (a_belief <> b_belief),
  unique (owner, a_belief, b_belief)
);
alter table public.kenning_because enable row level security;
create policy kenning_because_own on public.kenning_because for all using (auth.uid() = owner) with check (auth.uid() = owner);
-- Rollback:
--   drop table if exists public.kenning_because;
