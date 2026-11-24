-- Talk guide comfort and steering are private conversation state. Profile avoids are removed with the map/account.
alter table public.conversations add column if not exists guide_comfort text not null default 'ok'
  check (guide_comfort in ('ok', 'easing', 'follow_only'));
alter table public.conversations add column if not exists guide_steered_turns jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists talk_guide_avoids jsonb not null default '[]'::jsonb;
-- Rollback: alter table public.conversations drop column if exists guide_comfort, drop column if exists guide_steered_turns;
-- Rollback: alter table public.profiles drop column if exists talk_guide_avoids;
