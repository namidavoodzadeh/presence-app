-- E15 (CEO, support for app AR(2)): marks the one fictional Bridge practice-partner profile so it is never
-- confused with a real account. The row itself is seeded once via the Supabase Admin API (a real auth.users
-- row, same as the preview personas), not by this migration; this only adds the column it is flagged with.
alter table public.profiles
  add column if not exists is_practice_partner boolean not null default false;
