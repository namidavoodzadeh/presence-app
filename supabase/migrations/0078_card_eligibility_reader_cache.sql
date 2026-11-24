-- PSY 19 Nov 1b: cache the fail-closed content-reader result by exact item wording hash.
alter table public.beliefs
  add column if not exists card_eligibility_wording_hash text,
  add column if not exists card_eligibility_sensitive boolean;
-- Rollback:
--   alter table public.beliefs drop column if exists card_eligibility_wording_hash,
--     drop column if exists card_eligibility_sensitive;
