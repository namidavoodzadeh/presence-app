-- TQ3: private writer-owned note storage for the off-by-default Check-in foundation.
-- Safety-positive text never reaches this table; there is deliberately no partner read policy.
create table if not exists public.parked_notes (
  id uuid primary key default gen_random_uuid(),
  writer uuid not null references public.profiles(id) on delete cascade,
  partner uuid not null references public.profiles(id) on delete cascade,
  text text not null check (length(btrim(text)) > 0 and length(text) <= 4000),
  state text not null default 'parked' check (state in ('parked', 'later', 'talked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists parked_notes_writer_state_idx on public.parked_notes(writer, state, created_at);
alter table public.parked_notes enable row level security;
-- Authenticated clients cannot insert directly and bypass the safety gate. A server path may insert
-- with the service role only after decidePark returned `parked`.
create policy parked_notes_writer_read on public.parked_notes
  for select using (auth.uid() = writer);
create policy parked_notes_writer_update on public.parked_notes
  for update using (auth.uid() = writer) with check (auth.uid() = writer);
create policy parked_notes_writer_delete on public.parked_notes
  for delete using (auth.uid() = writer);
create trigger parked_notes_updated before update on public.parked_notes
  for each row execute function public.set_updated_at();
