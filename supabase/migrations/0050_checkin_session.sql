-- Shared check-in session (V2.5 board 28; CPO d-coo-cpo-b2b3-10nov: GO). Two linked people open one short session during an
-- active check-in. It is deliberately ephemeral: closing it (or letting it expire) DELETES every row below, so nothing about
-- the session (counts, who brought what, what was skipped) survives it. The only lasting marks are each person's own
-- 'We talked about it' on their own parked_notes, made through PATCH /checkin/notes/:id as before.
-- Additive: three new tables, no change to existing ones. All three are service-role only (RLS on, no policy): the API is the
-- only reader, and it shows the other person nothing until the session phase allows it. Nothing here is ever read by a model.
create table if not exists public.checkin_sessions (
  id uuid primary key default gen_random_uuid(),
  person_a uuid not null references public.profiles(id) on delete cascade, -- the smaller uuid, as links
  person_b uuid not null references public.profiles(id) on delete cascade,
  opened_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '4 hours'),
  check (person_a < person_b),
  unique (person_a, person_b) -- one at a time
);
-- one appreciation per person per session, stored as written until the session ends
create table if not exists public.checkin_session_parts (
  session uuid not null references public.checkin_sessions(id) on delete cascade,
  person uuid not null references public.profiles(id) on delete cascade,
  appreciation text check (appreciation is null or char_length(btrim(appreciation)) between 1 and 600),
  appreciated_at timestamptz,
  primary key (session, person)
);
-- the writer's own kept notes they bring (at most two each, enforced by the API); a reference, never a copy of the words
create table if not exists public.checkin_session_items (
  session uuid not null references public.checkin_sessions(id) on delete cascade,
  writer uuid not null references public.profiles(id) on delete cascade,
  note_id uuid not null references public.parked_notes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session, note_id)
);
alter table public.checkin_sessions enable row level security;
alter table public.checkin_session_parts enable row level security;
alter table public.checkin_session_items enable row level security;

-- Account deletion (delete_account tombstones the profile): drop any session the person is in at that moment.
create or replace function public.checkin_sessions_on_account_delete() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.checkin_sessions where person_a = new.id or person_b = new.id;
  return new;
end;
$$;
create trigger profiles_checkin_sessions_gone after update of deleted_at on public.profiles
  for each row when (new.deleted_at is not null and old.deleted_at is null) execute function public.checkin_sessions_on_account_delete();

-- rollback: drop trigger profiles_checkin_sessions_gone on public.profiles; drop function public.checkin_sessions_on_account_delete();
--           drop table public.checkin_session_items; drop table public.checkin_session_parts; drop table public.checkin_sessions;
