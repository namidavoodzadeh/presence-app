-- E34 (not deployed): the phone's MetricKit reports (POST /diagnostics) keep the release and the report as jsonb on errors
-- (a call stack can exceed the 2000-character detail). Idempotent per person and phone Ref for these two codes.
alter table public.errors add column if not exists release text;
alter table public.errors add column if not exists report jsonb;
create unique index if not exists errors_client_diag_once on public.errors (person, client_ref, code)
  where source = 'client' and code in ('client_crash', 'client_hang');
-- rollback: drop index public.errors_client_diag_once; alter table public.errors drop column report, drop column release;
