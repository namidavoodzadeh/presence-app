-- 0002_talk_state: what the Talk endpoints need beyond 0001 (engine lane, 2026-10-27).
--   conversations.hypotheses      the engine's per-conversation hypotheses (beliefs taking shape, including those under 0.7 that
--                                 were never shown), as the engine's own JSON; Finish consolidates them. Never shown in the app.
--   conversations.open_threads    threads Finish left open, fed back into the next session's context package.
--   conversations.title_by_person set when the person renames a conversation; the engine then stops retitling it.
--   consent.conversation_id already exists; consent.area holds the engine domain (e.g. body_health), label the words asked.
alter table public.conversations add column if not exists hypotheses jsonb not null default '[]'::jsonb;
alter table public.conversations add column if not exists open_threads text[] not null default '{}';
alter table public.conversations add column if not exists title_by_person boolean not null default false;
create index if not exists messages_conversation_turn on public.messages (conversation_id, turn, role);
create index if not exists receipts_message on public.receipts (message_id);
create index if not exists beliefs_owner_status on public.beliefs (owner, status);
