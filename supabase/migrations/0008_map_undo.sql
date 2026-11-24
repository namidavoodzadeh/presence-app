-- 0008_map_undo (engine lane, 2026-10-27; Q63 answered by the COO 17:30 Tehran: DELETE /map soft-deletes with a 5-second undo window,
--   the design's Undo rule, then hard-deletes).
--   profiles.map_delete_at   when set, "Delete my map" was tapped and the undo window closes at this time. Until then the map reads as
--                            empty (GET /map carries deleting.undo_until) and POST /map/undo clears it with nothing lost. From that time
--                            on, the first request the person makes purges the map (beliefs, conversations, outside cards, the Talk
--                            traces), as DELETE /map did at once before. No job: computed at request time, like paused conversations.
alter table public.profiles add column if not exists map_delete_at timestamptz;
