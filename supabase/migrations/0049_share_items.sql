-- Per-item sharing (CPO d-coo-cpo-v25-share-granularity-10nov, V2.5 board 18): the owner picks which single beliefs one
-- linked person may draw on. Nothing is shared by default. Only a belief the owner confirmed (rated Very me or Partly, or
-- edited; status 'confirmed', rating not 'not') can be offered. `wording` is the owner-approved text for that person (law 10);
-- it is what the person sees, never the belief's receipts, Talk quotes or private notes. Revoking deletes the row.
-- Additive: one new table, one helper function, three policies. link_prefs.share_* (the per-area share) is untouched here;
-- the API stops honouring it for friends (owner-testing accounts only).
create table if not exists public.share_items (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  other uuid not null references public.profiles(id) on delete cascade,
  belief_id uuid not null references public.beliefs(id) on delete cascade,
  wording text not null check (char_length(btrim(wording)) between 1 and 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner, other, belief_id),
  check (owner <> other)
);
create index if not exists share_items_other_idx on public.share_items(other, owner);
alter table public.share_items enable row level security;

-- True only while the belief is still the owner's confirmed, not-"Not me" belief. SECURITY DEFINER so the grantee, who
-- cannot read the belief, still gets the live check (a set-aside, deleted or re-rated belief stops being shared at once).
create or replace function public.share_item_live(p_belief uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.beliefs b where b.id = p_belief and b.owner = p_owner
                 and b.status = 'confirmed' and coalesce(b.rating, 'very') <> 'not')
$$;
revoke all on function public.share_item_live(uuid, uuid) from public;
grant execute on function public.share_item_live(uuid, uuid) to authenticated, service_role;

-- the owner reads, adds, edits and revokes their own grants, and only for a belief that is theirs and live
create policy share_items_owner_read on public.share_items for select using (auth.uid() = owner);
create policy share_items_owner_write on public.share_items for insert
  with check (auth.uid() = owner and public.share_item_live(belief_id, owner));
create policy share_items_owner_update on public.share_items for update
  using (auth.uid() = owner) with check (auth.uid() = owner and public.share_item_live(belief_id, owner));
create policy share_items_owner_delete on public.share_items for delete using (auth.uid() = owner);
-- the person it was shared with reads the grant (never the belief), and only while it is live
create policy share_items_grantee_read on public.share_items for select
  using (auth.uid() = other and public.share_item_live(belief_id, owner));
create trigger share_items_updated before update on public.share_items for each row execute function public.set_updated_at();

-- Account deletion: delete_account (0039) tombstones the profile (deleted_at) rather than deleting it, so a trigger drops every
-- grant the person made or received at that moment (their own also go with their beliefs, on delete cascade).
create or replace function public.share_items_on_account_delete() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.share_items where owner = new.id or other = new.id;
  return new;
end;
$$;
create trigger profiles_share_items_gone after update of deleted_at on public.profiles
  for each row when (new.deleted_at is not null and old.deleted_at is null) execute function public.share_items_on_account_delete();

-- rollback: drop trigger profiles_share_items_gone on public.profiles; drop function public.share_items_on_account_delete();
--           drop table public.share_items; drop function public.share_item_live(uuid, uuid);
