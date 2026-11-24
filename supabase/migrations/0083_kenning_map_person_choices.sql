-- C24b station choices. Additive and staging-first: every value belongs to one owner item,
-- never to a shared projection or a map-preferences record.
alter table public.beliefs
  add column if not exists keyword_override text check (keyword_override is null or keyword_override = 'none' or (char_length(keyword_override) between 1 and 18 and keyword_override !~ '\\s')),
  add column if not exists fold_opt_out boolean not null default false,
  add column if not exists line_exclusions text[] not null default '{}'::text[];

-- Rollback:
--   alter table public.beliefs drop column if exists line_exclusions,
--     drop column if exists fold_opt_out, drop column if exists keyword_override;
