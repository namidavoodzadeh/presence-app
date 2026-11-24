-- QA-B403 + QA-B404 (COO 03:20Z 17 Nov, CEO ruling GAP-1/GAP-2, d-cpo-ceo-coo-journey-gaps-16nov).
-- (1) B403: a removal by a person is not shown to the removed person: the `removed` thread_events rows written visible_to_b = true by
--     POST /links/:person/remove (before the route wrote them invisible, as a block's are) are flipped to false. Rows written by
--     delete_account (person_a is a deleted account, "Deleted account" in the other person's thread) stay visible: the thread needs
--     them to read as ended. Existing rows only; no data is lost, the rows are only hidden from the removed side.
-- (2) B404: delete_account (0039's body, one added step 1b) also withdraws bridges others scheduled to the deleted account that have
--     not come due, so nothing sits as scheduled when it can never arrive.
-- Rollback: re-run the function body from 0039_delete_account_rows_gone.sql. The flipped rows cannot be told apart afterwards; flipping
--     them back is not needed to roll back (they only hide a removal from the removed person).
update public.thread_events te set visible_to_b = false
where te.type = 'removed' and te.visible_to_b
  and exists (select 1 from public.profiles p where p.id = te.person_a and p.deleted_at is null);

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

  -- 1b. QA-B404 (COO 03:20Z 17 Nov, GAP-2): bridges other people scheduled TO this account and that have not come due can never arrive,
  --     so they are withdrawn now, silently (there is no one left to tell; the sender's thread stops listing them). Delivered or opened
  --     rows stay as the sender's copies. Not added to `withdrawn` (that list is this person's own bridges, shown to the other side).
  update bridges set status = 'withdrawn', withdrawn_at = now()
  where receiver = p_id and status = 'scheduled' and opened_at is null and deliver_at > now();

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
  -- 3b. Added in 0039 (SD6, rows-gone test): tables that came after 0029 and hold words or times only the person owned.
  delete from ai_imports where owner = p_id;            -- moments, guesses and their rounds go with it (on delete cascade / own owner rows below)
  delete from ai_import_moments where owner = p_id;
  delete from ai_import_guesses where owner = p_id;
  delete from parked_notes where writer = p_id;         -- their private notes; notes others wrote about them stay with those writers
  delete from check_ins where owner = p_id or person = p_id;
  delete from mirror_approvals where owner = p_id;
  delete from mirror_blocks where owner = p_id;
  delete from feedback where reporter = p_id;
  delete from errors where person = p_id;

  -- 4. The profile row stays, as "Deleted account", so opened bridges keep their sender; nothing personal is left on it.
  update profiles set name = 'Deleted account', photo_url = null, color = '#7D6BC9', settings = '{}'::jsonb,
    persona = null, is_preview = false, map_seen_at = null, apple_refresh_token_enc = null, deleted_at = now()
  where id = p_id;

  return jsonb_build_object('withdrawn', to_jsonb(withdrawn), 'links_ended', links_ended);
end;
$$;

revoke all on function public.delete_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;
