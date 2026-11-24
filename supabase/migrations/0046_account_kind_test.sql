-- CEO 9 Nov 16:45 PT: a flagged test account ("Jan (test)") on hosted for the two-phone Bridge. account_kind gains 'test'.
-- Additive: a wider check on a nullable column added in 0045; no row changes.
alter table public.profiles drop constraint if exists profiles_account_kind_check;
alter table public.profiles add constraint profiles_account_kind_check check (account_kind in ('canary', 'reviewer', 'test'));

-- rollback (only when no row holds 'test'; otherwise first: update public.profiles set account_kind = null where account_kind = 'test';):
-- alter table public.profiles drop constraint profiles_account_kind_check;
-- alter table public.profiles add constraint profiles_account_kind_check check (account_kind in ('canary', 'reviewer'));
