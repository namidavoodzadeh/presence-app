-- CPO 12 Nov 20:45Z (1f), contract v1.66: kennings already in the first person get that text as own_wording, unchanged.
-- Nothing else is copied or rewritten: second-person kennings keep own_wording null (the app shows the label), 'neither'
-- kennings keep it null (the app shows the statement). Idempotent. STAGING; hosted only on Nami's yes.
-- First person = opens with I, I'm, I've, I'd, I'll, My, Me or Mine (the same rule as the engine's isFirstPerson).
-- Run: PRESENCE_SUPABASE_ENV=staging python3 next/scripts/supabase_api.py sql next/scripts/backfill_own_wording_0057.sql
update public.beliefs
   set own_wording = btrim(statement)
 where own_wording is null
   and status = 'confirmed'
   and coalesce(rating, '') <> 'not'
   and char_length(btrim(statement)) between 1 and 400
   and btrim(statement) ~* '^(i|i[''’]m|i[''’]ve|i[''’]d|i[''’]ll|my|me|mine)\M'
returning id;
-- rollback (only rows this backfill set, i.e. own_wording equal to the statement on a non-own kenning):
--   update public.beliefs set own_wording = null where source <> 'own' and own_wording = btrim(statement);
