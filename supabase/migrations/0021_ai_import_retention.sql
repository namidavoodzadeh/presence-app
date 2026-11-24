-- TQ4: an imported core guess cannot occupy the foundation ring without Talk evidence.
-- The import API retains only de-identified guess rows for explicitly rated cards; raw pasted text has no column.
alter table public.beliefs
  add column if not exists pending_level text check (pending_level in ('L0','L1','L2','L3','L4'));

create or replace function public.promote_import_with_talk_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.beliefs
    set level = pending_level,
        kind = case pending_level when 'L0' then 'foundation' when 'L1' then 'rule' when 'L2' then 'rule' else 'everyday' end,
        pending_level = null
    where id = new.belief_id
      and source = 'import'
      and pending_level is not null;
  return new;
end;
$$;

drop trigger if exists receipts_promote_import on public.receipts;
create trigger receipts_promote_import after insert on public.receipts
  for each row execute function public.promote_import_with_talk_receipt();
