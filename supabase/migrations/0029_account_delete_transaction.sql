-- SD6 (system design work plan #6, P2): DELETE /account did its five steps as separate statements, so a failure partway
-- through (a dropped connection, a constraint error on one table) could leave bridges withdrawn with links still active,
-- or rows half-deleted with the profile tombstone never written. One function, one transaction: Postgres functions run as a
-- single transaction by default, so either every step lands or none do. The Edge Function calls this once, then (outside
-- the transaction, since it is a separate service, not a table write) deletes the Auth user and any linked-provider token.

create or replace function public.delete_account(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  withdrawn uuid[] := '{}';
  links_ended integer := 0;
  b record;
  l record;
begin
  -- 1. Bridges the other side has not opened are withdrawn. Shown as "withdrew" only where the other side already saw the
  --    sealed bubble (heads_up_seen_at) or the bridge had already reached deliver_at (delivered, unopened) — withdrawalSeen().
  for b in
    select id, receiver, heads_up_seen_at, deliver_at from bridges
    where sender = p_id and status = 'scheduled' and opened_at is null
  loop
    update bridges set status = 'withdrawn', withdrawn_at = now() where id = b.id;
    withdrawn := withdrawn || b.id;
    if b.heads_up_seen_at is not null or now() >= b.deliver_at then
      insert into thread_events (person_a, person_b, type, bridge_id) values (p_id, b.receiver, 'withdrew', b.id);
    end if;
  end loop;

  -- Bridges sent to this account can no longer be read: the senders keep their copies.
  update bridges set receiver_deleted_at = now() where receiver = p_id and receiver_deleted_at is null;

  -- 2. Every link ends: no new bridges either way; the other person's thread stays, read-only, under "Deleted account".
  for l in
    select id, case when person_a = p_id then person_b else person_a end as other
    from links where (person_a = p_id or person_b = p_id) and status = 'active'
  loop
    update links set status = 'removed' where id = l.id;
    insert into thread_events (person_a, person_b, type) values (p_id, l.other, 'removed');
    links_ended := links_ended + 1;
  end loop;

  -- 3. Everything that is only theirs. engine_calls first (service only); mirror_links takes contributions and approvals with it.
  delete from engine_calls where person = p_id;
  delete from conversations where owner = p_id;
  delete from beliefs where owner = p_id;
  delete from outside_perspectives where owner = p_id;
  delete from consent where owner = p_id;
  delete from drafts where owner = p_id;
  delete from invites where owner = p_id;
  delete from mirror_links where owner = p_id;
  delete from link_prefs where owner = p_id;
  delete from blocks where owner = p_id;
  delete from push_events where owner = p_id;
  delete from device_tokens where owner = p_id;

  -- 4. The profile row stays, as "Deleted account", so opened bridges keep their sender; nothing personal is left on it.
  update profiles set name = 'Deleted account', photo_url = null, color = '#7D6BC9', settings = '{}'::jsonb,
    persona = null, is_preview = false, map_seen_at = null, deleted_at = now()
  where id = p_id;

  return jsonb_build_object('withdrawn', to_jsonb(withdrawn), 'links_ended', links_ended);
end;
$$;

revoke all on function public.delete_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;
