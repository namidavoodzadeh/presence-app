-- Private one-turn-lag Talk guide. The brief is owned by (and therefore deleted with) its conversation.
alter table public.conversations add column if not exists guide_brief jsonb;
-- Rollback: alter table public.conversations drop column if exists guide_brief;
