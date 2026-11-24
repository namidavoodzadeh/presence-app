-- V3 communication model (CPO ruling, Q-ENG-READ1-CARRYOVER-1 (b), 15 Nov): the Map keeps every old kenning, including one the carry-over pass has given a kind,
-- and only items CREATED as communication items stay off it. One marker tells them apart: true on a row written by POST /comm/items (+ Add, a Talk bank answer),
-- false on every old kenning and on every carried-over one, whatever the person later does to its kind or its wording (comm_source cannot do this:
-- a re-word of a carried-over item sets it to 'typed').
-- Additive, STAGING FIRST, needs 0069 and 0072. No grant change; the beliefs row-level policy already covers a new column.
alter table public.beliefs
  add column if not exists comm_native boolean not null default false;
-- Rows written before this marker existed: an item with a recorded source was created as a communication item (0072 writes it on insert only).
update public.beliefs set comm_native = true where comm_kind is not null and comm_source is not null and comm_native = false;
-- Rollback:
--   alter table public.beliefs drop column if exists comm_native;
