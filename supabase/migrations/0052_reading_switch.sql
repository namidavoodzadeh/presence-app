-- V2.5 boards 10/11/11b/18 (app Q-ENG-READ1): the writer's per-person switch "Help <name> read my messages". Default off.
-- Additive: two columns on link_prefs (owner-only RLS already; the reader never sees the row, the route reads it with the service
-- client and answers the same 'not available' whether the switch is off or nothing supports a reading). Turning it off tells no one.
-- help_read_at is the 30-day private check's clock (set when switched on or 'Keep on').
alter table public.link_prefs add column if not exists help_read boolean not null default false;
alter table public.link_prefs add column if not exists help_read_at timestamptz;

-- rollback: alter table public.link_prefs drop column if exists help_read_at, drop column if exists help_read;
