-- V3 P8 alternating turns (app3 Q24, after the CPO's 12 Nov ruling (3); COO 19:25Z P8 turn order). Additive.
-- done_bringing_at: a text-free "Nothing else" mark on the person's own part row in the items step, so both phones can
-- tell "still choosing" from "brings nothing more" and move to the next turn on the same fact. No words, no count. The
-- parts row is deleted when the session ends or expires, so the mark goes with it (no streak, no history).
alter table public.checkin_session_parts add column if not exists done_bringing_at timestamptz;

-- rollback: alter table public.checkin_session_parts drop column done_bringing_at;
