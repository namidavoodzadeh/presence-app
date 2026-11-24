-- QA-B240: a draft keeps the last insight reply computed for exactly its text, so reopening an unchanged draft shows it without
-- another model call. insight_key is a sha256 of (text, relationship, with_wording, the sender's map belief ids/status/wording);
-- the route returns the saved reply only when the key still matches, so a changed draft or a changed map recomputes. The
-- stored reply is derived from the draft and lives on the draft's row: it goes when the draft is deleted or sent, and with the
-- account (delete_account removes drafts rows). Only state "insight" replies are saved; a safety stop or a failure never is.
-- Editing the text clears it here, so no spans for words that are no longer in the draft stay stored.
-- Rollback: drop trigger drafts_clear_insight on public.drafts; drop function public.drafts_clear_insight();
--           alter table public.drafts drop column insight, drop column insight_key, drop column insight_at;
alter table public.drafts add column if not exists insight jsonb, add column if not exists insight_key text, add column if not exists insight_at timestamptz;

create or replace function public.drafts_clear_insight() returns trigger language plpgsql as $$
begin
  if new.text is distinct from old.text then new.insight := null; new.insight_key := null; new.insight_at := null; end if;
  return new;
end $$;
drop trigger if exists drafts_clear_insight on public.drafts;
create trigger drafts_clear_insight before update on public.drafts for each row execute function public.drafts_clear_insight();
