-- sre-08: the contributor's 18+ attestation as a stored fact on the row (CONTRACT 11.1). Additive; no identity in it
-- (the row already carries only the hashed contributor key). RLS is unchanged: mirror_contributions is service-only.
-- Rollback: alter table public.mirror_contributions drop column adult_attested_at, drop column attestation_version;
alter table public.mirror_contributions
  add column if not exists adult_attested_at timestamptz,
  add column if not exists attestation_version text;
