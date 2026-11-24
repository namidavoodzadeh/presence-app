-- E36 (not deployed; adds only): fortnightly and monthly repeats, and one-date check-ins beside the one repeating check-in.
-- A person keeps one repeating check-in (unique owner+person stays) plus any number of dated ones. No message text anywhere.
alter table public.check_ins drop constraint if exists check_ins_repeats_check;
alter table public.check_ins add constraint check_ins_repeats_check check (repeats in ('weekly','fortnightly','monthly'));
-- The date a fortnightly repeat counts its two-week steps from; null for weekly and monthly.
alter table public.check_ins add column if not exists anchor date;

create table if not exists public.check_in_dates (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  person uuid not null references public.profiles(id) on delete cascade,
  on_date date not null,
  time text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  tz text not null,
  remind_other boolean not null default true,
  status text not null default 'invited' check (status in ('invited','active')),
  created_at timestamptz not null default now(),
  unique (owner, person, on_date)
);
alter table public.check_in_dates enable row level security;
-- Owner-only, as check_ins. The other person is reached by the API (service role) and by a content-free reminder.
create policy check_in_dates_owner_read on public.check_in_dates for select using (auth.uid() = owner);
create policy check_in_dates_owner_delete on public.check_in_dates for delete using (auth.uid() = owner);

-- rollback: drop table public.check_in_dates; alter table public.check_ins drop column anchor;
--   update public.check_ins set repeats='weekly' where repeats <> 'weekly';
--   alter table public.check_ins drop constraint check_ins_repeats_check;
--   alter table public.check_ins add constraint check_ins_repeats_check check (repeats = 'weekly');
