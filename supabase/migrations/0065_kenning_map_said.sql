-- V3 kenning map v2, PSY 15 Nov point 4 (Q-ENG-KMV2-LINES): "a membership never changes silently: it stays until the receipt is
-- deleted, the wording edited, or the person takes the line off." Additive. STAGING ONLY until the map pre-approval with QA PASS.
-- The engine's second line for a kenning, as chosen when the map first showed it: { "line": "<topic>", "w": "<wording key>" }. The
-- wording key is a short hash (FNV-1a), never a copy of the person's words. Null: no second line from the engine (none named, a harsh
-- statement about the self, or the person picked the lines themselves).
alter table public.beliefs add column if not exists map_said jsonb
  check (map_said is null or (jsonb_typeof(map_said) = 'object' and map_said ? 'line' and map_said ? 'w'));
-- Rollback:
--   alter table public.beliefs drop column if exists map_said;
