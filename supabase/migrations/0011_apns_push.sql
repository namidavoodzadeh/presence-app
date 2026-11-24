-- APNs sender (CONTRACT v1.16, APPLE-PAID-TEAM A4). Tokens and the outbox are service-only.
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  installation_id uuid not null,
  token text not null,
  token_hash text not null,
  environment text not null check (environment in ('sandbox','production')),
  bundle_id text not null check (bundle_id in ('com.namidavoodzadeh.presence','com.namidavoodzadeh.presence.qa')),
  locale text not null default 'en-US',
  enabled boolean not null default true,
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner, installation_id)
);
create unique index if not exists device_tokens_active_token_idx
  on public.device_tokens(environment, bundle_id, token_hash) where enabled;
alter table public.device_tokens enable row level security;
alter table public.device_tokens force row level security;
revoke all on public.device_tokens from anon, authenticated;

create table if not exists public.push_events (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.device_tokens(id) on delete cascade,
  kind text not null check (kind in ('bridge_ready','bridge_reminder','talk_reply_ready')),
  subject_id uuid not null,
  route_target_id uuid not null,
  due_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','sending','sent','cancelled','retry','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null,
  apns_id uuid,
  last_status integer,
  last_reason text,
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner, kind, subject_id, device_id)
);
create index if not exists push_events_due_idx on public.push_events(state, next_attempt_at);
alter table public.push_events enable row level security;
alter table public.push_events force row level security;
revoke all on public.push_events from anon, authenticated;

create or replace function public.register_apns_device(
  p_owner uuid, p_installation_id uuid, p_token text, p_environment text, p_bundle_id text, p_locale text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d device_tokens%rowtype; h text := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
begin
  update device_tokens set enabled = false, invalidated_at = now()
    where environment = p_environment and bundle_id = p_bundle_id and token_hash = h
      and not (owner = p_owner and installation_id = p_installation_id) and enabled;
  insert into device_tokens(owner, installation_id, token, token_hash, environment, bundle_id, locale)
    values (p_owner, p_installation_id, p_token, h, p_environment, p_bundle_id, p_locale)
  on conflict (owner, installation_id) do update set
    token = excluded.token, token_hash = excluded.token_hash, environment = excluded.environment,
    bundle_id = excluded.bundle_id, locale = excluded.locale, enabled = true,
    registered_at = now(), last_seen_at = now(), invalidated_at = null
  returning * into d;
  return jsonb_build_object('id', d.id, 'installation_id', d.installation_id, 'environment', d.environment,
    'bundle_id', d.bundle_id, 'locale', d.locale, 'enabled', d.enabled,
    'registered_at', d.registered_at, 'last_seen_at', d.last_seen_at);
end $$;
revoke all on function public.register_apns_device(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.register_apns_device(uuid,uuid,text,text,text,text) to service_role;

create or replace function public.remove_apns_device(p_owner uuid, p_installation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from device_tokens where owner = p_owner and installation_id = p_installation_id;
end $$;
revoke all on function public.remove_apns_device(uuid,uuid) from public, anon, authenticated;
grant execute on function public.remove_apns_device(uuid,uuid) to service_role;

create or replace function public.enqueue_push_events() returns trigger language plpgsql security definer set search_path = public as $$
declare enabled_pref boolean; reminder_changed boolean := false; event_owner uuid; subject uuid; target uuid; event_kind text; event_due timestamptz;
begin
  if tg_table_name = 'messages' then
    if new.role <> 'presence' then return new; end if;
    select coalesce((settings #>> '{notify,talk_replies}')::boolean, true) into enabled_pref from profiles where id = new.owner;
    if not enabled_pref then return new; end if;
    event_owner := new.owner; subject := new.id;
    event_kind := 'talk_reply_ready'; target := new.conversation_id; event_due := now();
  else
    if new.status <> 'scheduled' or new.opened_at is not null or new.receiver_deleted_at is not null then
      update push_events set state = 'cancelled', cancelled_at = now()
        where subject_id = new.id and state in ('pending','retry');
      return new;
    end if;
    if tg_op = 'UPDATE' then reminder_changed := new.remind_at is distinct from old.remind_at; end if;
    if reminder_changed then
      update push_events set state = 'cancelled', cancelled_at = now()
        where subject_id = new.id and kind = 'bridge_reminder' and state in ('pending','retry');
      if new.remind_at is null then return new; end if;
      select coalesce((settings #>> '{notify,talk_reminders}')::boolean, true) into enabled_pref from profiles where id = new.receiver;
      event_kind := 'bridge_reminder'; event_due := new.remind_at;
    else
      select coalesce((settings #>> '{notify,bridges_ready}')::boolean, true) into enabled_pref from profiles where id = new.receiver;
      event_kind := 'bridge_ready'; event_due := new.deliver_at;
    end if;
    if not enabled_pref then return new; end if;
    event_owner := new.receiver; subject := new.id; target := new.sender;
  end if;
  insert into push_events(owner, device_id, kind, subject_id, route_target_id, due_at, next_attempt_at)
    select event_owner, d.id, event_kind, subject, target, event_due, event_due
    from device_tokens d
    where d.owner = event_owner and d.enabled
  on conflict (owner, kind, subject_id, device_id) do update set
    route_target_id = excluded.route_target_id, due_at = excluded.due_at,
    next_attempt_at = excluded.next_attempt_at, state = 'pending', cancelled_at = null;
  return new;
end $$;

create or replace function public.cancel_disabled_push_preferences() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce((new.settings #>> '{notify,bridges_ready}')::boolean, true) = false then
    update push_events set state = 'cancelled', cancelled_at = now()
      where owner = new.id and kind = 'bridge_ready' and state in ('pending','retry');
  end if;
  if coalesce((new.settings #>> '{notify,talk_reminders}')::boolean, true) = false then
    update push_events set state = 'cancelled', cancelled_at = now()
      where owner = new.id and kind = 'bridge_reminder' and state in ('pending','retry');
  end if;
  if coalesce((new.settings #>> '{notify,talk_replies}')::boolean, true) = false then
    update push_events set state = 'cancelled', cancelled_at = now()
      where owner = new.id and kind = 'talk_reply_ready' and state in ('pending','retry');
  end if;
  return new;
end $$;

drop trigger if exists messages_push_event on public.messages;
create trigger messages_push_event after insert on public.messages for each row execute function public.enqueue_push_events();
drop trigger if exists bridges_push_event on public.bridges;
create trigger bridges_push_event after insert or update of deliver_at,remind_at,status,opened_at,receiver_deleted_at
  on public.bridges for each row execute function public.enqueue_push_events();
drop trigger if exists profiles_push_preferences on public.profiles;
create trigger profiles_push_preferences after update of settings on public.profiles
  for each row execute function public.cancel_disabled_push_preferences();

create or replace function public.claim_push_events(p_limit integer default 100)
returns setof jsonb language sql security definer set search_path = public as $$
  with picked as (
    select p.id from push_events p join device_tokens d on d.id = p.device_id
    where p.state in ('pending','retry','sending') and p.next_attempt_at <= now() and d.enabled
    order by p.next_attempt_at, p.created_at for update of p skip locked limit least(greatest(p_limit, 1), 100)
  ), claimed as (
    update push_events p set state = 'sending', attempts = p.attempts + 1, next_attempt_at = now() + interval '2 minutes'
    from picked where p.id = picked.id returning p.*
  )
  select jsonb_build_object('id', c.id, 'owner', c.owner, 'device_id', c.device_id, 'kind', c.kind,
    'subject_id', c.subject_id, 'route_target_id', c.route_target_id, 'due_at', c.due_at,
    'attempts', c.attempts, 'token', d.token, 'environment', d.environment, 'bundle_id', d.bundle_id)
  from claimed c join device_tokens d on d.id = c.device_id;
$$;
revoke all on function public.claim_push_events(integer) from public, anon, authenticated;
grant execute on function public.claim_push_events(integer) to service_role;
