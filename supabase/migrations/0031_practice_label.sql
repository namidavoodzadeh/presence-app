-- E24 (C) remainder (COO 2026-11-07 00:20 Tehran): a "Practice" label on the example people, distinct from
-- `is_example`. `is_example` already drives several unrelated things (the preview-cast reset in seed_preview.py,
-- the QA pair Jo who is never shown to the owner, DELETE /map's and DELETE /account's example-account refusal) and
-- the app currently has to infer "this is a practice person" on the phone itself. `is_practice` is a plain,
-- additive signal the app can read directly instead: true for the owner's own practice cast (Lea, Mom, Sam, Ari,
-- Dara), false for everything else, including Jo (the QA pair's other half, never linked to the owner).

alter table public.profiles add column if not exists is_practice boolean not null default false;

-- Backfill: every example person seeded so far is part of the owner's practice cast except Jo (persona `jo`),
-- who carries no link to Nami at all (seed_preview.py links Jo only to Sam, for the QA pair's own short talk).
update public.profiles set is_practice = true where is_example = true and (persona is null or persona != 'jo');
