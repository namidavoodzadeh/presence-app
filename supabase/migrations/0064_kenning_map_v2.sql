-- V3 kenning map v2 (HQ d-all-kenning-map-v2-14nov; Nami 15:38 PT 14 Nov: one word per station). Additive. STAGING ONLY until the map
-- pre-approval with QA PASS. One plain word per kenning, made with the kenning (Talk's turn reply) or by the one-time backfill; it is a
-- name the engine gives the station, never a rating. Line memberships and fold groups are computed at map time from existing rows.
alter table public.beliefs add column if not exists map_keyword text
  check (map_keyword is null or (char_length(map_keyword) between 1 and 18 and map_keyword !~ '\s'));
-- Rollback:
--   alter table public.beliefs drop column if exists map_keyword;
