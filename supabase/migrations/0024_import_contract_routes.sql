-- E8: app-facing import contract. The server switch remains off by default.
alter table public.ai_imports
  add column if not exists knows_me text check (knows_me in ('a lot','some','a little')),
  add column if not exists imported_at timestamptz,
  add column if not exists processed_on_device boolean not null default false;

alter table public.ai_import_guesses
  add column if not exists about text;

-- Import receipt metadata is not a Talk receipt and never enters public.receipts.
alter table public.beliefs
  add column if not exists import_assistant text,
  add column if not exists import_date date,
  add column if not exists import_merge_key text;

create unique index if not exists beliefs_owner_import_merge_key_idx
  on public.beliefs(owner, import_merge_key)
  where source = 'import' and import_merge_key is not null and status <> 'deleted';
