-- E40 (not deployed; adds only): when an accepted check-in was moved, and who moved it; when a dated check-in was accepted.
-- No message text anywhere; nothing here is sent to a person as a notification.
alter table public.check_ins add column if not exists moved_at timestamptz;
alter table public.check_ins add column if not exists moved_by uuid references public.profiles(id) on delete set null;
alter table public.check_in_dates add column if not exists accepted_at timestamptz;
update public.check_in_dates set accepted_at = created_at where status = 'active' and accepted_at is null;

-- rollback: alter table public.check_ins drop column moved_at, drop column moved_by; alter table public.check_in_dates drop column accepted_at;
