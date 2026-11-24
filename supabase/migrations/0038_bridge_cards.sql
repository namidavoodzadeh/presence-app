-- Bridge history as cards (not deployed): one shared state per sent message. No row means "open". Read and written only
-- through the API (service role); neither person has a table policy, so the receiver's rules (nothing before delivery, words
-- only once opened) stay in one place.
create table if not exists public.bridge_cards (
  bridge_id uuid primary key references public.bridges(id) on delete cascade,
  state text not null default 'open' check (state in ('open','kept','talked','resolved')),
  set_by uuid not null references public.profiles(id) on delete cascade,
  set_at timestamptz not null default now()
);
alter table public.bridge_cards enable row level security;
-- rollback: drop table public.bridge_cards;
