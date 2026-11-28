-- Issue #8, CONTRACT §7 "AI consent" (from §11.4 L6; App Store 5.1.2(i)): the person's agreement, by version, that their words go
-- to the named AI providers. One row per agreement. A withdrawal sets withdrawn_at and nothing else; a new agreement (or a new
-- version) adds a row, so the record of what was agreed and when stays whole. The per-area Talk `consent` table is not reused.
-- The API reads and writes with the caller's own session (RLS below). DELETE /account removes the rows with the profile (cascade).
-- Rollback: drop table if exists public.ai_consent; drop function if exists public.ai_consent_only_withdraw();
--           alter table public.messages drop column if exists pending_consent, drop column if exists consent_claimed_at;
--           alter table public.mirror_contributions drop column if exists contributor_id;

create table if not exists public.ai_consent (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  version text not null check (length(version) between 1 and 32),
  providers text[] not null check (cardinality(providers) > 0),
  at timestamptz not null default now(),
  withdrawn_at timestamptz,
  client_ref text,
  created_at timestamptz not null default now(),
  check (withdrawn_at is null or withdrawn_at >= at)
);
create index if not exists ai_consent_owner_idx on public.ai_consent(owner, at desc);
-- One open agreement per person and version: two concurrent submissions cannot both add a row.
create unique index if not exists ai_consent_one_open on public.ai_consent(owner, version) where withdrawn_at is null;

-- A new agreement is stamped by the database: its time is now, never a client's value; it must name Anthropic, the provider
-- that receives words today; and it starts open.
create or replace function public.ai_consent_on_insert() returns trigger language plpgsql set search_path = public as $$
begin
  new.at := now();
  new.created_at := now();
  new.withdrawn_at := null;
  -- Only the version the API offers today; a client cannot add an unknown (newer) version that would hide a valid one.
  if new.version <> '2027-01' then
    raise exception 'invalid: unknown ai_consent version';
  end if;
  if new.providers is distinct from array['anthropic']::text[] then
    raise exception 'invalid: an ai_consent row names exactly the providers that receive words today (anthropic)';
  end if;
  return new;
end;
$$;
drop trigger if exists ai_consent_on_insert on public.ai_consent;
create trigger ai_consent_on_insert before insert on public.ai_consent for each row execute function public.ai_consent_on_insert();

alter table public.ai_consent enable row level security;
create policy "ai_consent own read" on public.ai_consent for select to authenticated using (owner = auth.uid());
create policy "ai_consent own insert" on public.ai_consent for insert to authenticated with check (owner = auth.uid());
create policy "ai_consent own withdraw" on public.ai_consent for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

-- Never updated in place: only withdrawn_at may change, and only from empty to a time.
create or replace function public.ai_consent_only_withdraw() returns trigger language plpgsql set search_path = public as $$
begin
  if new.id is distinct from old.id or new.owner is distinct from old.owner or new.version is distinct from old.version
     or new.providers is distinct from old.providers or new.at is distinct from old.at or new.client_ref is distinct from old.client_ref
     or new.created_at is distinct from old.created_at or old.withdrawn_at is not null then
    raise exception 'invalid: an ai_consent row is history; only withdrawn_at may be set, once';
  end if;
  -- A withdrawal is stamped now by the database, never a client's (possibly future) time.
  if new.withdrawn_at is not null then
    new.withdrawn_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists ai_consent_only_withdraw on public.ai_consent;
create trigger ai_consent_only_withdraw before update on public.ai_consent for each row execute function public.ai_consent_only_withdraw();

-- Review round 4: an answer kept while consent was missing is marked, so the API replaces or removes only these rows (never a regular
-- Talk answer) and the turn does not move past words no model has checked.
alter table public.messages add column if not exists pending_consent boolean not null default false;
-- Round 8: the request that settles a kept answer claims it, so a concurrent retry does not answer it a second time.
alter table public.messages add column if not exists consent_claimed_at timestamptz;
-- Round 5: at most one per conversation, enforced here, so two concurrent requests cannot both keep one.
create unique index if not exists messages_one_pending_consent on public.messages(conversation_id) where pending_consent;

-- A Mirror moment held for the owner's approval keeps its contributor's id until it is read, so consent is checked again
-- when it is released. Service role only (the table has RLS and no policies): the owner never sees it. Cleared once read.
alter table public.mirror_contributions add column if not exists contributor_id uuid references public.profiles(id) on delete set null;
