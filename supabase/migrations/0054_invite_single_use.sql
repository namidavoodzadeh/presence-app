-- V3 H2 "Add a person" (app Q-APP-V3-7; COO 12 Nov 07:17Z, Q-ENG-INVITE1 yes; STAGING ONLY until Nami's yes for hosted).
-- An invite code links ONE person and lasts 7 days. Until now accept_invite never looked at accepted_by, so a forwarded link
-- could link any number of people to the inviter (law 10: the app's given-first share on that link could reach a stranger).
-- A used code (accepted_at set; accepted_by alone can be nulled when the joiner deletes their account) is now refused by
-- accept_invite and peek_invite with not_found, the same answer as revoked or expired. The joiner who used it gets 'conflict'
-- on accept (they are already linked, as before), so a retry of their own accept reads the same as it did.
-- New invites default to 7 days; existing rows keep their expires_at. Additive: two function bodies and one column default.
alter table public.invites alter column expires_at set default now() + interval '7 days';

create or replace function public.accept_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i invites%rowtype; me uuid := auth.uid(); l links%rowtype; a uuid; b uuid;
begin
  select * into i from invites where code = p_code and not revoked and expires_at > now() for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if i.owner = me then raise exception 'invalid' using errcode = 'P0001'; end if;
  if i.accepted_at is not null or i.accepted_by is not null then
    if i.accepted_by = me then raise exception 'conflict' using errcode = 'P0001'; end if;
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  a := least(i.owner, me); b := greatest(i.owner, me);
  if exists (select 1 from links where person_a = a and person_b = b) then raise exception 'conflict' using errcode = 'P0001'; end if;
  insert into links (person_a, person_b, invite_id) values (a, b, i.id) returning * into l;
  insert into link_prefs (owner, other) values (i.owner, me), (me, i.owner) on conflict do nothing;
  update invites set accepted_by = me, accepted_at = now() where id = i.id;
  insert into thread_events (person_a, person_b, type) values (me, i.owner, 'joined');
  return jsonb_build_object('link_id', l.id, 'person', i.owner);
end $$;

create or replace function public.peek_invite(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare i invites%rowtype; me uuid := auth.uid(); p profiles%rowtype;
begin
  if me is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into i from invites where code = p_code and not revoked and expires_at > now()
    and accepted_at is null and accepted_by is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if i.owner = me then raise exception 'invalid' using errcode = 'P0001'; end if;
  select * into p from profiles where id = i.owner and deleted_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('name', p.name, 'initial', p.initial, 'expires_at', i.expires_at);
end $$;

-- create or replace keeps each function's existing grants (0001 and 0051); none change here.

-- rollback: alter table public.invites alter column expires_at set default now() + interval '30 days'; then re-run the
-- accept_invite body from 0001_app_v1.sql (line 500) and the peek_invite body from 0051_peek_invite.sql (both
-- create or replace; grants are kept). No data changes either way.
