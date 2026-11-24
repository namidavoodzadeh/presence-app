-- E32 (not deployed): the weekly check-in schedule, where a parked item came from, and the content-free reminder push.
-- A check-in holds no message text. One per owner and person (the app's "several per person" question is open).
create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  person uuid not null references public.profiles(id) on delete cascade,
  repeats text not null default 'weekly' check (repeats = 'weekly'),
  day text not null check (day in ('sunday','monday','tuesday','wednesday','thursday','friday','saturday')),
  time text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  tz text not null,
  remind_other boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner, person)
);
alter table public.check_ins enable row level security;
-- Owner-only. The other person has no read policy: they are only ever sent a reminder with no content (law 10).
create policy check_ins_owner_read on public.check_ins for select using (auth.uid() = owner);
create policy check_ins_owner_delete on public.check_ins for delete using (auth.uid() = owner);
create trigger check_ins_updated before update on public.check_ins
  for each row execute function public.set_updated_at();

-- Where a parked item came from: a plain note, a bridged message, or a topic. A reference, never a copy of the words.
alter table public.parked_notes
  add column if not exists origin text not null default 'note' check (origin in ('note','bridged','topic')),
  add column if not exists origin_ref uuid;

-- The reminder push to the other person: one new kind. subject_id is the check_in id; route_target_id is the owner.
alter table public.push_events drop constraint if exists push_events_kind_check;
alter table public.push_events add constraint push_events_kind_check
  check (kind in ('bridge_ready','bridge_reminder','talk_reply_ready','checkin_reminder'));

alter table public.push_events add column if not exists occurrence timestamptz; -- which check-in time a reminder was queued for

-- rollback: drop table public.check_ins; alter table public.parked_notes drop column origin, drop column origin_ref;
--   alter table public.push_events drop column occurrence;
--   delete from public.push_events where kind='checkin_reminder';
--   alter table public.push_events drop constraint push_events_kind_check;
--   alter table public.push_events add constraint push_events_kind_check check (kind in ('bridge_ready','bridge_reminder','talk_reply_ready'));
