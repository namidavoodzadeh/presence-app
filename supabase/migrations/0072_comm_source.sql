-- V3 communication model (contract v1.91): how an item's words came to be, so You's receipt line can read "Typed, 15 November" or "Said in Talk, 15 November".
-- One nullable column on beliefs. 'typed' = the person typed the words (+ Add, or a re-word); 'talk_said' = they said them in a Talk answer and tapped That's me.
-- Null on every old kenning and every carried-over item (their receipt is the date alone). Never written from inference (spec 4.5): the API accepts only these two.
-- Additive, STAGING FIRST, needs 0069. No grant change; the beliefs row-level policy already covers it.
alter table public.beliefs
  add column if not exists comm_source text
    check (comm_source in ('typed','talk_said'));
-- Rollback:
--   alter table public.beliefs drop column if exists comm_source;
