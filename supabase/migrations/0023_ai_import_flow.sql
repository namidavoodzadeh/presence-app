-- R14: approved PSY v1 import flow. The server switch remains off by default.
alter table public.ai_imports drop constraint if exists ai_imports_status_check;
alter table public.ai_imports
  add column if not exists source_assistant text not null default 'other',
  add column if not exists source_date date not null default current_date,
  add column if not exists last_opened_at timestamptz not null default now();
alter table public.ai_imports
  add constraint ai_imports_status_check check (status in ('ready','active','answered','cleared'));

alter table public.ai_import_guesses
  add column if not exists status text not null default 'waiting',
  add column if not exists priority integer not null default 0,
  add column if not exists confidence double precision not null default 0.35 check (confidence between 0 and 1),
  add column if not exists merge_key text,
  add column if not exists rated_at timestamptz,
  add column if not exists retired_at timestamptz;
alter table public.ai_import_guesses
  add constraint ai_import_guesses_status_check check (status in ('waiting','rated','retired'));
create index if not exists ai_import_guesses_owner_merge_key_idx
  on public.ai_import_guesses(owner, merge_key) where merge_key is not null;
create index if not exists ai_import_guesses_waiting_idx
  on public.ai_import_guesses(owner, import_id, priority desc) where status = 'waiting';

create table if not exists public.ai_import_moments (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.ai_imports(id) on delete cascade,
  owner uuid not null references public.profiles(id) on delete cascade,
  what_happened text not null,
  what_they_did_or_said text not null,
  ai_words text,
  area text not null,
  source text not null default 'import' check (source = 'import'),
  source_mark text not null default 'from_your_ai' check (source_mark = 'from_your_ai'),
  created_at timestamptz not null default now()
);
alter table public.ai_import_moments enable row level security;
create policy ai_import_moments_own on public.ai_import_moments for all
  using (auth.uid() = owner) with check (auth.uid() = owner);

-- Quiet guesses have no 14-day expiry. A scheduled/operator call may retire them after 90 days.
create or replace function public.retire_quiet_ai_import_guesses(as_of timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  update public.ai_import_guesses g
    set status = 'retired', retired_at = as_of
    from public.ai_imports i
    where g.import_id = i.id
      and g.status = 'waiting'
      and i.last_opened_at < as_of - interval '90 days';
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function public.retire_quiet_ai_import_guesses(timestamptz) from public;
grant execute on function public.retire_quiet_ai_import_guesses(timestamptz) to service_role;
