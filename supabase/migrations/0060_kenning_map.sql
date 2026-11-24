-- V3 kenning map (CEO 13 Nov 00:40Z; spec "Kenember map and share cards: build spec", section 2). Additive. STAGING ONLY until Nami's yes.
-- Every field is set by the person; the engine adds no size, direction or conflict (advisor principle).
alter table public.beliefs add column if not exists map_lines text[] check (map_lines is null or cardinality(map_lines) between 1 and 2);
alter table public.beliefs add column if not exists map_order jsonb not null default '{}'::jsonb;   -- {"<line>": int}, the person's order on that line; always wins
alter table public.beliefs add column if not exists central boolean not null default false;          -- set only by the person
alter table public.beliefs add column if not exists central_asked boolean not null default false;    -- the one 'central to you?' question was put once
alter table public.beliefs add column if not exists hidden_from_map boolean not null default false;  -- 'Keep but don't show': stays in the List
alter table public.beliefs add column if not exists prior_wording text;                              -- earlier wording kept when wording moved
alter table public.beliefs add column if not exists changed_at timestamptz;
alter table public.beliefs add column if not exists map_seen_at timestamptz;                         -- first view clears 'new'

create table if not exists public.kenning_links (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  a_belief uuid not null references public.beliefs(id) on delete cascade,
  b_belief uuid not null references public.beliefs(id) on delete cascade,
  kind text not null check (kind in ('both_true','comes_from')),  -- comes_from: "for me, a comes from b"
  note text check (note is null or char_length(note) between 1 and 300),
  created_at timestamptz not null default now(),
  check (a_belief <> b_belief),
  unique (owner, a_belief, b_belief, kind)
);
alter table public.kenning_links enable row level security;
create policy kenning_links_own on public.kenning_links for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- rollback:
--   drop table if exists public.kenning_links;
--   alter table public.beliefs drop column if exists map_seen_at, drop column if exists changed_at, drop column if exists prior_wording,
--     drop column if exists hidden_from_map, drop column if exists central_asked, drop column if exists central,
--     drop column if exists map_order, drop column if exists map_lines;
