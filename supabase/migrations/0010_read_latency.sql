-- A-Q24: the hosted read paths filter these tables by owner on every GET /map.
-- Existing primary/foreign-key indexes cover profiles and receipts; these three owner scans did not have matching indexes.
create index if not exists beliefs_owner_created_live
  on public.beliefs (owner, created_at) where status <> 'deleted';
create index if not exists belief_links_owner_from
  on public.belief_links (owner, from_belief);
create index if not exists belief_links_owner_to
  on public.belief_links (owner, to_belief);
create index if not exists outside_perspectives_owner_created
  on public.outside_perspectives (owner, created_at desc);
