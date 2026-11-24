-- POST /feedback (COO 12:30 10-31, tester report intake): a private storage bucket plus one row per
-- report, service role only (the function validates auth or the tester token itself). report_id is the
-- client's idempotency key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback', 'feedback', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  report_id text not null unique,          -- the client's idempotency key
  reporter uuid references public.profiles(id) on delete set null,   -- null for a tester-token submission
  body jsonb not null,
  screenshot_path text not null,           -- object path inside the "feedback" bucket
  created_at timestamptz not null default now(),
  pulled_at timestamptz                    -- set by next/scripts/pull_feedback.py once collected into the inbox
);
alter table public.feedback enable row level security;   -- service role only
