-- Q36 (not deployed to production; staging only until Nami says yes): a new account kind for the two flagged personas the
-- signed policy names: the hourly canary and the Apple reviewer. Null for every real person and every preview persona.
alter table public.profiles add column if not exists account_kind text check (account_kind in ('canary', 'reviewer'));

-- rollback: alter table public.profiles drop column account_kind;
