-- PSY 19 Nov: retain the Ask source so set-aside, retirement, or narrowed scope can silently stop new answers.
alter table public.mirror_links add column if not exists ask_source_item_id uuid references public.beliefs(id) on delete set null;
create index if not exists mirror_links_ask_source_item_idx on public.mirror_links (owner, ask_source_item_id)
  where ask_source_item_id is not null;
-- Rollback:
--   drop index if exists public.mirror_links_ask_source_item_idx;
--   alter table public.mirror_links drop column if exists ask_source_item_id;
