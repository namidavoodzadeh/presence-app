-- 0004_threads_client_ref (engine lane, 2026-10-27, COO check-in 14:20 Tehran, items (b) and (d)).
--   errors.source / client_ref   a Ref the phone made itself (S05, when Presence never answered) arrives on the next request as
--                                X-Client-Ref and is kept here with source 'client', so a screenshot's Ref can still be looked up.
--   link_prefs.cleared_at        "Delete conversation" on a thread removes the viewer's copy only: everything in the thread up to
--                                this moment is hidden for them (the other side keeps theirs).
--   receiver_delete_thread()     the receiver's copy of every delivered bridge from one sender, in one call (the receiver has no
--                                bridges policy; they write only through security-definer functions, as in 0001).
alter table public.errors add column if not exists source text not null default 'api' check (source in ('api', 'client'));
alter table public.errors add column if not exists client_ref text;
alter table public.link_prefs add column if not exists cleared_at timestamptz;

create or replace function public.receiver_delete_thread(p_sender uuid) returns integer
language sql security definer set search_path = public as $$
  with d as (
    update bridges set receiver_deleted_at = now()
    where sender = p_sender and receiver = auth.uid() and now() >= deliver_at and receiver_deleted_at is null
    returning id)
  select count(*)::int from d;
$$;
grant execute on function public.receiver_delete_thread(uuid) to authenticated;
