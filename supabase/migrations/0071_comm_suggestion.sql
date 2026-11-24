-- V3 communication model, spec 4.7 carry-over: where one pending suggestion lives until the person answers it.
-- The carry-over job (next/scripts/comm_carryover_job.ts) gives every old kenning a placeholder (comm_kind 'other', private_only) and, when its
-- checks pass, a suggestion {kind, confidence, topic}. The person confirms a few at a time ("That's me" writes the kind) or dismisses it (the
-- column is cleared; the item stays under Other). The suggestion never holds words: kind from the closed list, a number, a topic from the list.
-- lands_hard and this_week can never be suggested (spec 4.5): the check names the six kinds that can. Additive (one column, two checks), STAGING
-- FIRST, needs 0069. Old rows keep null.
alter table public.beliefs
  add column if not exists comm_suggestion jsonb;
alter table public.beliefs drop constraint if exists beliefs_comm_suggestion_shape;
alter table public.beliefs add constraint beliefs_comm_suggestion_shape check (
  comm_suggestion is null or (
    jsonb_typeof(comm_suggestion) = 'object'
    and comm_suggestion ?& array['kind','confidence']
    and (comm_suggestion - 'kind' - 'confidence' - 'topic') = '{}'::jsonb
    and comm_suggestion->>'kind' in ('how_i_mean','feels_like_care','bring_up','gets_heated','coming_back','matters')
    and jsonb_typeof(comm_suggestion->'confidence') = 'number'
    and (comm_suggestion->>'confidence')::numeric between 0 and 1
    and (comm_suggestion->'topic' is null or jsonb_typeof(comm_suggestion->'topic') = 'null'
         or comm_suggestion->>'topic' in ('relationships','work','family','body','money','meaning','politics','morality'))
    and (comm_suggestion->>'kind' = 'matters' or comm_suggestion->'topic' is null or jsonb_typeof(comm_suggestion->'topic') = 'null')
  ));
alter table public.beliefs drop constraint if exists beliefs_comm_suggestion_pending;
alter table public.beliefs add constraint beliefs_comm_suggestion_pending check (
  comm_suggestion is null or (comm_kind = 'other' and comm_status = 'private_only'));
-- Rollback:
--   alter table public.beliefs drop constraint if exists beliefs_comm_suggestion_pending, drop constraint if exists beliefs_comm_suggestion_shape;
--   alter table public.beliefs drop column if exists comm_suggestion;
