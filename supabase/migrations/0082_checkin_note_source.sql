-- K-0096: the exact editable source for a newly parked check-in item. Old rows deliberately remain NULL: matching
-- text could open the wrong special-category source. The app treats NULL as an informational, non-tappable row.
alter table public.parked_notes add column if not exists source jsonb;

-- New private notes store {"kind":"note","id":"<their parked_notes id>"}; future Talk and card callers store
-- {"kind":"conversation"|"card","id":"<source id>"}. No backfill.
alter table public.parked_notes add constraint parked_notes_source_shape check (
  source is null or (
    jsonb_typeof(source) = 'object'
    and source->>'kind' in ('note', 'conversation', 'card')
    and coalesce(source->>'id', '') <> ''
  )
);

-- rollback: alter table public.parked_notes drop constraint if exists parked_notes_source_shape; alter table public.parked_notes drop column if exists source;
