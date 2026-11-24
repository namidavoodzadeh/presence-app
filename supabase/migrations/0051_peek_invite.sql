-- V2.5 onboarding (app Q-V25-ON2): a signed-in person who opened an invite link can see WHO invited them before accepting.
-- Read-only: reads one row, writes nothing, notifies nobody, marks nothing. The invites table stays owner-only (RLS), so the
-- code is still never listable; this function answers for one exact code and returns only the inviter's first name, initial
-- and the expiry. A revoked or expired code is 'not_found', same as accept_invite. Additive: one function, no table change.
create or replace function public.peek_invite(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare i invites%rowtype; me uuid := auth.uid(); p profiles%rowtype;
begin
  if me is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into i from invites where code = p_code and not revoked and expires_at > now();
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if i.owner = me then raise exception 'invalid' using errcode = 'P0001'; end if;
  select * into p from profiles where id = i.owner and deleted_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('name', p.name, 'initial', p.initial, 'expires_at', i.expires_at);
end $$;
revoke all on function public.peek_invite(text) from public, anon;
grant execute on function public.peek_invite(text) to authenticated;

-- rollback: drop function public.peek_invite(text);
