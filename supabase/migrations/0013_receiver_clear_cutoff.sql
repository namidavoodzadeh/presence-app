-- 0013_receiver_clear_cutoff (engine lane, 2026-10-29, QA-B16).
-- A receiver's Delete conversation cutoff applies to when a bridge was created. Filtering in the API by
-- deliver_at kept an already-cleared sealed bridge and could not distinguish it from a bridge scheduled
-- afterward for the same delivery time. Keep the creation timestamp inside the security-definer function;
-- receiver_view remains the only shape returned to the app.

drop function if exists public.receiver_bridges(uuid);

create or replace function public.receiver_bridges(
  p_sender uuid,
  p_created_after timestamptz default null
) returns setof jsonb language sql security definer stable set search_path = public as $$
  select receiver_view(b) from bridges b
  where b.receiver = auth.uid() and b.sender = p_sender
    and (p_created_after is null or b.created_at > p_created_after)
    and not exists (select 1 from blocks k where k.owner = auth.uid() and k.blocked = p_sender)
    and receiver_view(b) is not null
  order by b.deliver_at;
$$;

grant execute on function public.receiver_bridges(uuid, timestamptz) to authenticated;
