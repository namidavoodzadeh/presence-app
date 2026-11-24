-- V3 P8 check-in session and Talked about (COO 12 Nov 19:25Z; CPO 18:45Z rulings (2) and (3); app Q-APP-V3-17). Additive.
-- (1) said_at: a text-free 'said' mark for the appreciation step. The good thing is said aloud; nothing is typed, stored,
--     screened or counted. The mark lives on the session's parts row, so closing or expiring the session deletes it with
--     everything else (no streak, no history).
-- (2) first: who speaks first, the same on both phones: the person who accepted the check-in invite. Set when the session
--     opens; the session row (and this value) is deleted when the session ends.
-- (3) closed_in_check_in: a card marked talked or resolved while the two people had a check-in session open. The CPO's
--     Talked about list tags those rows 'At the check-in'. A boolean only: no session id, count or time beyond set_at.
alter table public.checkin_session_parts add column if not exists said_at timestamptz;
alter table public.checkin_sessions add column if not exists first uuid references public.profiles(id) on delete cascade;
alter table public.bridge_cards add column if not exists closed_in_check_in boolean not null default false;

-- rollback: alter table public.bridge_cards drop column closed_in_check_in;
--           alter table public.checkin_sessions drop column first; alter table public.checkin_session_parts drop column said_at;
