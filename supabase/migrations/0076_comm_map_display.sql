-- V3 C24 kind-line map: two person-owned display choices on communication
-- items. They affect only the owner's V3 Map/List presentation; neither field
-- grants access, changes a pair context, or changes a receipt.
alter table public.beliefs
  add column if not exists comm_hidden_from_map boolean not null default false,
  add column if not exists comm_show_separately boolean not null default false;

-- Rollback:
--   alter table public.beliefs drop column if exists comm_show_separately,
--     drop column if exists comm_hidden_from_map;
