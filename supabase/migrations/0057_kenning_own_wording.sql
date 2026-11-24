-- V3 kenning voice and own kennings (CPO 12 Nov 20:45Z (1), option A; COO 21:20Z Q-ENG-KENNING-VOICE + Q-ENG-OWN-KENNING). Additive.
-- own_wording: the kenning in the person's own first-person voice, set only by the person: confirming the exact offered text
--   on the Y5 card ('That's me'), an owner edit (Y2/H2 'Edit the words'), or a line they typed (POST /beliefs, source own).
--   It is the only first-person text the app may show as the person's line (law 3). `statement` stays the engine's gentle
--   second-person sentence for review cards and Talk's reflection (law 5); nothing here rewrites it.
-- offered_wording: Talk's first-person offer for a guess, written in the same call and through the same checks as the statement.
--   Never shown anywhere but the Y5 'Is this you?' card; once the person confirms that exact text it is copied to own_wording.
-- source 'own': a kenning the person typed themselves (F4b); no model call, one receipt row quoting the typed line (law 2).
alter table public.beliefs add column if not exists own_wording text check (own_wording is null or char_length(own_wording) between 1 and 400);
alter table public.beliefs add column if not exists offered_wording text check (offered_wording is null or char_length(offered_wording) between 1 and 400);
alter table public.beliefs drop constraint if exists beliefs_source_check;
alter table public.beliefs add constraint beliefs_source_check check (source in ('talk','mirror','import','own'));

-- rollback (delete own kennings first, or the check fails):
--   delete from public.beliefs where source = 'own';
--   alter table public.beliefs drop constraint if exists beliefs_source_check;
--   alter table public.beliefs add constraint beliefs_source_check check (source in ('talk','mirror','import'));
--   alter table public.beliefs drop column if exists offered_wording;
--   alter table public.beliefs drop column if exists own_wording;
