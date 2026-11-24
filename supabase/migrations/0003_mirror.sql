-- 0003_mirror: what the Mirror endpoints need beyond 0001 (engine lane, 2026-10-27, NEXT item 6).
--   mirror_approvals            one row per contributor who asked to use an "Only people I approve" link (Y02 approvals list):
--                               the only place a contributor's name is ever stored next to the owner, and never beside a moment.
--   mirror_contributions        the raw moment is deleted once processed (thesis: retention); what stays is the de-identified
--                               observation the listener wrote, its theme key (convergence grouping), its weight and its map match.
--   outside_perspectives        the synthesis writes type, area, domains, kind and the paraphrased summary; variant says whether the
--                               card is a new belief from outside, quiet support for a belief on the map (status 'quiet': no card,
--                               no alert, only "seen by others"), or a different view of one (a tension card).
create table if not exists public.mirror_approvals (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.mirror_links(id) on delete cascade,
  owner uuid not null references public.profiles(id) on delete cascade,
  contributor_key text not null,
  contributor_name text not null default '',
  how_known text,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (link_id, contributor_key)
);
alter table public.mirror_approvals enable row level security;
create policy mirror_approvals_own_read on public.mirror_approvals for select using (auth.uid() = owner);

alter table public.mirror_contributions alter column moment drop not null;
alter table public.mirror_contributions add column if not exists observation jsonb;
alter table public.mirror_contributions add column if not exists theme_key text;
alter table public.mirror_contributions add column if not exists weight numeric not null default 1.0;
alter table public.mirror_contributions add column if not exists map_belief_id uuid references public.beliefs(id) on delete set null;
alter table public.mirror_contributions add column if not exists map_relation text check (map_relation in ('supports','contradicts'));
alter table public.mirror_contributions add column if not exists map_confidence numeric;
alter table public.mirror_contributions add column if not exists processed_at timestamptz;
alter table public.mirror_contributions add column if not exists perspective_id uuid;
create index if not exists mirror_contributions_theme on public.mirror_contributions (link_id, theme_key, status);

alter table public.outside_perspectives add column if not exists summary text;
alter table public.outside_perspectives add column if not exists type text;
alter table public.outside_perspectives add column if not exists kind text;
alter table public.outside_perspectives add column if not exists area text;
alter table public.outside_perspectives add column if not exists domains text[] not null default '{}';
alter table public.outside_perspectives add column if not exists variant text not null default 'new' check (variant in ('new','support','tension'));
alter table public.outside_perspectives add column if not exists about_belief_id uuid references public.beliefs(id) on delete set null;
alter table public.outside_perspectives add column if not exists theme_key text;
alter table public.outside_perspectives add column if not exists from_sample boolean not null default false;
alter table public.outside_perspectives drop constraint if exists outside_perspectives_status_check;
alter table public.outside_perspectives add constraint outside_perspectives_status_check check (status in ('new','rated','not_now','set_aside','quiet'));
create index if not exists outside_perspectives_theme on public.outside_perspectives (owner, theme_key);
