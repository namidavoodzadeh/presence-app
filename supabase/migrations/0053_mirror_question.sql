-- V3 Mirror ask (CDO boards Y6 and X2; COO 12 Nov 05:20Z, Q-ENG-MIRROR-Q yes, STAGING ONLY until Nami's yes for hosted).
-- The owner's one question on their Mirror link ("When do I shut a conversation down?"), shown on the contributor page above the
-- moment prompts. The owner's own words, at most 140 characters; the API runs the safety floor before it stores anything and makes
-- no model call. Additive: one nullable column on mirror_links (owner-only RLS already; the page reads it through the service
-- client). Cleared by POST /mirror/rotate; DELETE /mirror deletes the row with it.
alter table public.mirror_links add column if not exists question text;
alter table public.mirror_links drop constraint if exists mirror_links_question_len;
alter table public.mirror_links add constraint mirror_links_question_len
  check (question is null or (char_length(question) between 1 and 140));

-- rollback: alter table public.mirror_links drop constraint if exists mirror_links_question_len, drop column if exists question;
