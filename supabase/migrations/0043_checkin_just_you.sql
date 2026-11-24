-- E37 (not deployed; relaxes one constraint, loosens no grant): a "Just you" check-in has no other person.
-- person becomes nullable on check_ins and check_in_dates; at most one repeating "Just you" row per owner and one per date.
-- It is active from the start (nobody to invite), and nothing in it reaches another person: no reminder, no parked notes.
alter table public.check_ins alter column person drop not null;
alter table public.check_in_dates alter column person drop not null;
create unique index if not exists check_ins_just_you_one on public.check_ins (owner) where person is null;
create unique index if not exists check_in_dates_just_you_one on public.check_in_dates (owner, on_date) where person is null;
-- rollback: delete from public.check_in_dates where person is null; delete from public.check_ins where person is null;
--   drop index check_in_dates_just_you_one; drop index check_ins_just_you_one;
--   alter table public.check_in_dates alter column person set not null; alter table public.check_ins alter column person set not null;
