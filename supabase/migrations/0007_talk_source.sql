-- 0007_talk_source (engine lane, 2026-10-27; CPO decisions approved by the owner, COO 16:00 Tehran).
--   conversations.source   'talk' for an ordinary conversation; 'bridge_refused' when it was started from S15b "Talk it through"
--                          (Bridge would not carry the words, so the person talks them through instead). Such a conversation is exempt from
--                          the per-person daily Talk limit, never from the spend caps.
alter table public.conversations add column if not exists source text not null default 'talk' check (source in ('talk','bridge_refused'));
