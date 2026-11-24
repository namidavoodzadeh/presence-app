-- Import from your AI is behind PRESENCE_IMPORT_FROM_AI (off by default).
alter table public.beliefs drop constraint if exists beliefs_source_check;
alter table public.beliefs add constraint beliefs_source_check check (source in ('talk','mirror','import'));

create table if not exists public.ai_imports (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'ready' check (status in ('ready','answered')),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create table if not exists public.ai_import_guesses (
  id uuid primary key,
  import_id uuid not null references public.ai_imports(id) on delete cascade,
  owner uuid not null references public.profiles(id) on delete cascade,
  label text not null, statement text not null, type text not null, area text not null, note text not null,
  created_at timestamptz not null default now()
);
alter table public.ai_imports enable row level security;
alter table public.ai_import_guesses enable row level security;
create policy ai_imports_own on public.ai_imports for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy ai_import_guesses_own on public.ai_import_guesses for all using (auth.uid() = owner) with check (auth.uid() = owner);
