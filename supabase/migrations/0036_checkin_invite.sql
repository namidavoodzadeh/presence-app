-- E33 (not deployed): a check-in starts only when the other person accepts. New rows are invites; the reminder push and
-- "Next check-in" delivery only use accepted ones. Existing rows (0035 is not on hosted yet) become active so nothing in flight changes.
alter table public.check_ins
  add column if not exists status text not null default 'invited' check (status in ('invited','active')),
  add column if not exists accepted_at timestamptz;
update public.check_ins set status = 'active', accepted_at = coalesce(accepted_at, created_at) where status = 'invited';
-- The invitee reads and answers an invite through the API (service role); no read policy is added for them here (law 10).
-- rollback: alter table public.check_ins drop column status, drop column accepted_at;
