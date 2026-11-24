-- 0005_data (engine lane, 2026-10-27, CONTRACT §7 Data; thesis law 10: export or delete in one tap).
--   profiles.deleted_at   "Delete my account" keeps the profile row, renamed "Deleted account", so the bridges the person
--                         opened before leaving stay with their receivers (the design's "Edit, delete and archive rules").
--                         The auth user is soft-deleted and the API answers 401 for a deleted profile, so no sign-in works again.
alter table public.profiles add column if not exists deleted_at timestamptz;
