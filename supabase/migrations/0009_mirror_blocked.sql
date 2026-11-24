-- 0009_mirror_blocked (engine lane, 2026-10-28; B-Q10 / CONTRACT v1.15).
-- A block is stored by the outside card that caused it and by each opaque contributor key behind that card. The API groups rows by
-- perspective before anything reaches the owner: Settings sees only the card id and its de-identified label, never a key, person name,
-- contribution, or people count. There is deliberately no client RLS policy; only the service-backed API reads or changes these rows.
-- No mirror_links foreign key: blocks survive link rotation and deletion, as §11.2 requires.
create table if not exists public.mirror_blocks (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  perspective_id uuid not null constraint mirror_blocks_perspective_id_fkey
    references public.outside_perspectives(id) on delete cascade,
  contributor_key text not null,
  created_at timestamptz not null default now(),
  unique (owner, perspective_id, contributor_key)
);
create index if not exists mirror_blocks_owner_created on public.mirror_blocks (owner, created_at);
alter table public.mirror_blocks enable row level security;
