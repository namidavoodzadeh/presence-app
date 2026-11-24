-- TQ2: distinguish a tapped topic from words the person told Presence.
-- The text remains the episode answer; answer_kind controls evidence strength and receipt presentation.
alter table public.messages
  add column if not exists answer_kind text not null default 'told'
  check (answer_kind in ('told', 'chip', 'consent'));
