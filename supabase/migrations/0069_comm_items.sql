-- V3 communication model, spec section 4.1 (CPO 15 Nov, docs/engine/COMM-SPEC-DIGEST.md). Additive, STAGING FIRST, behind the owner-only switch.
-- A kenning now also says what kind of communication item it is, who it applies to, when, and for how long. Old rows keep every value
-- they have (level, lens, slot, type, kind, area) and are not read for the new model; the new columns are all nullable, so no old row
-- breaks and no old reader changes. beliefs.kind (foundation/rule/everyday) is untouched; the new one is comm_kind.
alter table public.beliefs
  add column if not exists comm_kind text
    check (comm_kind in ('how_i_mean','feels_like_care','bring_up','lands_hard','gets_heated','coming_back','matters','other','this_week')),
  add column if not exists comm_scope_type text
    check (comm_scope_type in ('everyone','type','person')),
  add column if not exists comm_scope_value text,
  add column if not exists comm_when text check (comm_when is null or char_length(comm_when) <= 120),
  add column if not exists comm_expires_at timestamptz,
  add column if not exists comm_last_confirmed_at timestamptz,
  add column if not exists comm_status text
    check (comm_status in ('active','set_aside','private_only')),
  add column if not exists comm_topic text
    check (comm_topic in ('relationships','work','family','body','money','meaning','politics','morality'));

-- One check per rule, so a failure names the rule.
-- A new item has a kind and a scope together; an old row has neither.
alter table public.beliefs add constraint beliefs_comm_scope_shape check (
  (comm_kind is null and comm_scope_type is null and comm_scope_value is null and comm_status is null)
  or (comm_kind is not null and comm_scope_type is not null and comm_status is not null
      and ((comm_scope_type = 'everyone' and comm_scope_value is null)
        or (comm_scope_type = 'type' and comm_scope_value is not null and comm_scope_value in ('partner','family','friends','coworker'))
        or (comm_scope_type = 'person' and comm_scope_value is not null and comm_scope_value <> ''))));
-- This week expires and nothing else does (the spec: "forbidden otherwise").
alter table public.beliefs add constraint beliefs_comm_expiry check (
  (comm_kind = 'this_week' and comm_expires_at is not null)
  or (comm_kind is distinct from 'this_week' and comm_expires_at is null));
-- The old topics survive only as the optional tag on What matters to me.
alter table public.beliefs add constraint beliefs_comm_topic_only_matters check (comm_topic is null or comm_kind = 'matters');

create index if not exists beliefs_comm_expiry_idx on public.beliefs (comm_expires_at) where comm_expires_at is not null;
create index if not exists beliefs_comm_owner_kind_idx on public.beliefs (owner, comm_kind) where comm_kind is not null;
-- Rollback (nothing else touched):
--   drop index if exists public.beliefs_comm_owner_kind_idx; drop index if exists public.beliefs_comm_expiry_idx;
--   alter table public.beliefs drop constraint if exists beliefs_comm_topic_only_matters,
--     drop constraint if exists beliefs_comm_expiry, drop constraint if exists beliefs_comm_scope_shape;
--   alter table public.beliefs drop column if exists comm_topic, drop column if exists comm_status, drop column if exists comm_last_confirmed_at,
--     drop column if exists comm_expires_at, drop column if exists comm_when, drop column if exists comm_scope_value,
--     drop column if exists comm_scope_type, drop column if exists comm_kind;
