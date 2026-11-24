-- Presence App v1 — schema (APP-V1-BUILD.md §4, CONTRACT.md v1). Engine lane, 2026-10-27.
-- Every table has id uuid, created_at, and RLS: a person reads and writes only their own rows, except where
-- noted. Receivers read bridges only through receiver_bridges()/open_bridge(). The ledger, engine_calls
-- and errors are service-role only (no policies for authenticated users).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- 4-character Ref from an unambiguous alphabet (no 0/O/1/I).
create or replace function public.new_ref() returns text language plpgsql as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; out text := ''; i int;
begin
  for i in 1..4 loop out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
  return out;
end $$;

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  initial text generated always as (upper(left(name, 1))) stored,
  color text not null default '#7D6BC9',
  photo_url text,
  is_example boolean not null default false,
  is_preview boolean not null default false,
  persona text unique,                       -- preview persona slug (nami, lea, mom, sam, ari, dara)
  settings jsonb not null default '{}'::jsonb,
  map_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy profiles_own on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- talk
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  title text not null default '',
  status text not null default 'active' check (status in ('active','paused','finished')),
  mode text not null default 'voice' check (mode in ('voice','text')),
  started_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  paused_at timestamptz,
  finished_at timestamptz,
  summary text,
  next_time text,
  belief_id uuid,                            -- "Talk about this" starter, if any
  risk_turn int,                             -- the turn mapping stopped on, if any
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_owner_idx on public.conversations(owner, last_active_at desc);
alter table public.conversations enable row level security;
create policy conversations_own on public.conversations for all using (auth.uid() = owner) with check (auth.uid() = owner);
create trigger conversations_updated before update on public.conversations for each row execute function public.set_updated_at();

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  owner uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('me','presence')),
  turn int not null,
  text text not null default '',
  feeling text check (feeling in ('neutral','confused','sad','lonely','angry','happy','excited')),
  reply jsonb,                               -- presence rows: state, reflection, question, move, consent, cards, early_guess, safety, ref
  superseded boolean not null default false,
  edited_at timestamptz,
  deleted_at timestamptz,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages(conversation_id, turn, role);
alter table public.messages enable row level security;
create policy messages_own on public.messages for all using (auth.uid() = owner) with check (auth.uid() = owner);

create table if not exists public.engine_calls (
  id uuid primary key default gen_random_uuid(),
  person uuid references public.profiles(id) on delete set null,
  purpose text not null,                     -- turn | repair | finish | insight | analyse | rewrite | verify | reword | why | mirror
  model text not null,
  request jsonb not null,                    -- the package sent: system, messages, maxTokens, thinking
  response text,                             -- the raw reply
  input_tokens int, output_tokens int,
  cents int not null default 0,
  ms int,
  ledger_id uuid,
  conversation_id uuid,
  error text,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists engine_calls_person_idx on public.engine_calls(person, created_at desc);
alter table public.engine_calls enable row level security;   -- service role only

-- ---------------------------------------------------------------- map
create table if not exists public.beliefs (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  statement text not null,
  type text not null check (type in ('something I believe is true','a rule I live by','something I do to cope','a view or taste','how I tend to react')),
  kind text not null check (kind in ('foundation','rule','everyday')),
  level text check (level in ('L0','L1','L2','L3','L4')),
  area text not null check (area in ('relationships','work','family','body','money','meaning','politics','morality')),
  domains text[] not null default '{}',
  birth_mood text not null default 'neutral' check (birth_mood in ('neutral','confused','sad','lonely','angry','happy','excited')),
  status text not null default 'guess' check (status in ('guess','confirmed','set_aside','deleted')),
  previous_status text,
  rating text check (rating in ('not','partly','very')),
  previous_rating text,
  confidence real not null default 0.7 check (confidence >= 0 and confidence <= 1),
  source text not null default 'talk' check (source in ('talk','mirror')),
  seen_by_others boolean not null default false,
  conversation_id uuid references public.conversations(id) on delete set null,
  rated_at timestamptz, confirmed_at timestamptz, set_aside_at timestamptz, deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists beliefs_owner_idx on public.beliefs(owner, status);
alter table public.beliefs enable row level security;
create policy beliefs_own on public.beliefs for all using (auth.uid() = owner) with check (auth.uid() = owner);
create trigger beliefs_updated before update on public.beliefs for each row execute function public.set_updated_at();

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  belief_id uuid not null references public.beliefs(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  quote text not null,
  said_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists receipts_belief_idx on public.receipts(belief_id);
create index if not exists receipts_message_idx on public.receipts(message_id);
alter table public.receipts enable row level security;
create policy receipts_own on public.receipts for all using (auth.uid() = owner) with check (auth.uid() = owner);

create table if not exists public.belief_links (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  from_belief uuid not null references public.beliefs(id) on delete cascade,
  to_belief uuid not null references public.beliefs(id) on delete cascade,
  kind text not null check (kind in ('rests_on','holds_up','tension','same_area')),
  created_at timestamptz not null default now(),
  unique (from_belief, to_belief, kind)
);
alter table public.belief_links enable row level security;
create policy belief_links_own on public.belief_links for all using (auth.uid() = owner) with check (auth.uid() = owner);

create table if not exists public.consent (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  area text not null,                        -- engine domain or design area
  label text not null,                       -- the topic as asked ("your health")
  state text not null check (state in ('allowed','not_now','never')),
  conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists consent_owner_idx on public.consent(owner, state);
alter table public.consent enable row level security;
create policy consent_own on public.consent for all using (auth.uid() = owner) with check (auth.uid() = owner);
create trigger consent_updated before update on public.consent for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- people
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  owner uuid not null references public.profiles(id) on delete cascade,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  revoked boolean not null default false,
  expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now()
);
alter table public.invites enable row level security;
create policy invites_own on public.invites for all using (auth.uid() = owner) with check (auth.uid() = owner);
-- accepting goes through accept_invite() (security definer), so the code is never listable

create table if not exists public.links (
  id uuid primary key default gen_random_uuid(),
  person_a uuid not null references public.profiles(id) on delete cascade,
  person_b uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active','removed','blocked')),
  blocked_by uuid,
  invite_id uuid references public.invites(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (person_a <> person_b),
  unique (person_a, person_b)
);
create index if not exists links_a_idx on public.links(person_a); create index if not exists links_b_idx on public.links(person_b);
alter table public.links enable row level security;
create policy links_party on public.links for select using (auth.uid() in (person_a, person_b));
create policy links_party_update on public.links for update using (auth.uid() in (person_a, person_b)) with check (auth.uid() in (person_a, person_b));
create trigger links_updated before update on public.links for each row execute function public.set_updated_at();

create table if not exists public.link_prefs (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  other uuid not null references public.profiles(id) on delete cascade,
  relationship text check (relationship in ('partner','friend','family','coworker')),
  muted_until timestamptz,                   -- 'infinity' for always
  archived boolean not null default false,
  pinned boolean not null default false,
  unread boolean not null default false,
  read_receipts boolean not null default true,
  share_on boolean not null default false,
  share_areas text[] not null default '{}',
  share_quotes boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner, other)
);
alter table public.link_prefs enable row level security;
create policy link_prefs_own on public.link_prefs for all using (auth.uid() = owner) with check (auth.uid() = owner);
-- the other side may read whether you share with them (shares_map on their People row)
create policy link_prefs_other_read on public.link_prefs for select using (auth.uid() = other);
create trigger link_prefs_updated before update on public.link_prefs for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- bridge
create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  other uuid not null references public.profiles(id) on delete cascade,
  text text not null default '',
  reply_to uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner, other)
);
alter table public.drafts enable row level security;
create policy drafts_own on public.drafts for all using (auth.uid() = owner) with check (auth.uid() = owner);
create trigger drafts_updated before update on public.drafts for each row execute function public.set_updated_at();

create table if not exists public.bridges (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references public.profiles(id) on delete cascade,
  receiver uuid not null references public.profiles(id) on delete cascade,
  reply_to uuid references public.bridges(id) on delete set null,
  original text not null,
  bridged text,
  final text not null,
  used text not null check (used in ('bridged','mine','edited')),
  outcome text check (outcome in ('ok','nothing_to_change','could_not_bridge','wont_carry')),
  changes jsonb not null default '[]'::jsonb,
  points jsonb not null default '[]'::jsonb,
  tone_original text, tone_bridged text,
  show_original boolean not null default false,
  heads_up boolean not null default true,
  deliver_at timestamptz not null,
  tz text not null default 'UTC',
  status text not null default 'scheduled' check (status in ('draft','scheduled','withdrawn')),
  opened_at timestamptz,
  withdrawn_at timestamptz,
  heads_up_seen_at timestamptz,              -- set when the receiver's thread showed the sealed bubble
  sender_deleted_at timestamptz, receiver_deleted_at timestamptz,
  ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bridges_sender_idx on public.bridges(sender, receiver, created_at);
create index if not exists bridges_receiver_idx on public.bridges(receiver, deliver_at);
alter table public.bridges enable row level security;
-- the sender owns the row; the receiver has NO policy: they read only through receiver_bridges()/open_bridge()
create policy bridges_sender on public.bridges for all using (auth.uid() = sender) with check (auth.uid() = sender);
create trigger bridges_updated before update on public.bridges for each row execute function public.set_updated_at();

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  bridge_id uuid not null references public.bridges(id) on delete cascade,
  proposer uuid not null references public.profiles(id) on delete cascade,
  other uuid not null references public.profiles(id) on delete cascade,
  soon boolean not null default false,
  at timestamptz,
  status text not null default 'planned' check (status in ('planned','talked','cancelled')),
  talked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.plans enable row level security;
create policy plans_party on public.plans for all using (auth.uid() in (proposer, other)) with check (auth.uid() in (proposer, other));
create trigger plans_updated before update on public.plans for each row execute function public.set_updated_at();

create table if not exists public.thread_events (
  id uuid primary key default gen_random_uuid(),
  person_a uuid not null references public.profiles(id) on delete cascade,   -- who acted
  person_b uuid not null references public.profiles(id) on delete cascade,   -- the other side
  type text not null check (type in ('talked','withdrew','removed','blocked','joined')),
  bridge_id uuid references public.bridges(id) on delete set null,
  plan_id uuid references public.plans(id) on delete set null,
  visible_to_b boolean not null default true,                                  -- a block is never shown to the blocked
  created_at timestamptz not null default now()
);
alter table public.thread_events enable row level security;
create policy thread_events_party on public.thread_events for select using (auth.uid() = person_a or (auth.uid() = person_b and visible_to_b));
create policy thread_events_insert on public.thread_events for insert with check (auth.uid() = person_a);

-- ---------------------------------------------------------------- mirror
create table if not exists public.mirror_links (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null unique references public.profiles(id) on delete cascade,
  slug text not null unique,
  enabled boolean not null default false,
  who text not null default 'anyone' check (who in ('anyone','approved')),
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mirror_links enable row level security;
create policy mirror_links_own on public.mirror_links for all using (auth.uid() = owner) with check (auth.uid() = owner);
create trigger mirror_links_updated before update on public.mirror_links for each row execute function public.set_updated_at();

create table if not exists public.mirror_contributions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.mirror_links(id) on delete cascade,
  owner uuid not null references public.profiles(id) on delete cascade,
  contributor_key text not null,             -- hashed device/session key; example cast: the persona id
  contributor_name text,                     -- shown only in approvals, never with a moment
  how_known text,
  prompt text,
  moment text not null,
  status text not null default 'pending' check (status in ('pending','pending_approval','declined','dropped','used')),
  dropped_reason text,
  created_at timestamptz not null default now()
);
create index if not exists mirror_contributions_link_idx on public.mirror_contributions(link_id, status);
alter table public.mirror_contributions enable row level security;   -- service role only: the owner never sees a contribution

create table if not exists public.outside_perspectives (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  statement text not null,
  people_count int not null default 0,
  moment_count int not null default 0,
  status text not null default 'new' check (status in ('new','rated','not_now','set_aside')),
  rating text check (rating in ('not','partly','very')),
  belief_id uuid references public.beliefs(id) on delete set null,
  contribution_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.outside_perspectives enable row level security;
create policy outside_own on public.outside_perspectives for all using (auth.uid() = owner) with check (auth.uid() = owner);
create trigger outside_updated before update on public.outside_perspectives for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- safety
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references public.profiles(id) on delete cascade,
  reported uuid not null references public.profiles(id) on delete cascade,
  bridge_ids uuid[] not null default '{}',
  reason text,
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
create policy reports_own on public.reports for all using (auth.uid() = reporter) with check (auth.uid() = reporter);

create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  blocked uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (owner, blocked)
);
alter table public.blocks enable row level security;
create policy blocks_own on public.blocks for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- ---------------------------------------------------------------- ledger, errors
create table if not exists public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  utc_day date not null default (now() at time zone 'utc')::date,
  kind text not null,                        -- talk_turn | talk_finish | bridge_insight | bridge_run | ... | seed:sqlite
  person uuid references public.profiles(id) on delete set null,
  owner_preview boolean not null default false,
  reserved_micros bigint not null check (reserved_micros >= 0),
  spent_micros bigint check (spent_micros >= 0),
  model text,
  receipt text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists usage_ledger_day_idx on public.usage_ledger(utc_day);
alter table public.usage_ledger enable row level security;   -- service role only

create table if not exists public.errors (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default public.new_ref(),
  person uuid references public.profiles(id) on delete set null,
  where_ text not null,
  code text not null,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.errors enable row level security;         -- service role only

-- Caps (daily_admission.py): 3,000¢ a day for everyone, +500¢ for the owner's preview use, 20,000¢ in total.
create or replace function public.ledger_reserve(p_kind text, p_person uuid, p_worst_micros bigint, p_owner_preview boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare day date := (now() at time zone 'utc')::date;
        day_cap bigint := 3000 * 10000; total_cap bigint := 20000 * 10000;
        day_used bigint; total_used bigint; new_id uuid;
begin
  perform pg_advisory_xact_lock(7742);
  if p_owner_preview then day_cap := day_cap + 500 * 10000; end if;
  select coalesce(sum(coalesce(spent_micros, reserved_micros)), 0) into day_used from usage_ledger where utc_day = day;
  select coalesce(sum(coalesce(spent_micros, reserved_micros)), 0) into total_used from usage_ledger;
  if day_used + p_worst_micros > day_cap then
    return jsonb_build_object('ok', false, 'error', 'daily_limit', 'day_used_micros', day_used, 'day_cap_micros', day_cap,
                              'opens_at', ((day + 1)::timestamp at time zone 'utc'));
  end if;
  if total_used + p_worst_micros > total_cap then
    return jsonb_build_object('ok', false, 'error', 'total_limit', 'total_used_micros', total_used, 'total_cap_micros', total_cap);
  end if;
  insert into usage_ledger (utc_day, kind, person, owner_preview, reserved_micros) values (day, p_kind, p_person, p_owner_preview, p_worst_micros)
    returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'day_used_micros', day_used, 'day_cap_micros', day_cap, 'total_used_micros', total_used);
end $$;

create or replace function public.ledger_settle(p_id uuid, p_spent_micros bigint, p_model text, p_receipt text default null)
returns void language sql security definer set search_path = public as $$
  update usage_ledger set spent_micros = least(p_spent_micros, reserved_micros), model = p_model, receipt = p_receipt, settled_at = now()
  where id = p_id and settled_at is null;
$$;

create or replace function public.ledger_snapshot()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'utc_day', (now() at time zone 'utc')::date,
    'today_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date), 0) / 10000.0),
    'owner_preview_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger where utc_day = (now() at time zone 'utc')::date and owner_preview), 0) / 10000.0),
    'total_cents', ceil(coalesce((select sum(coalesce(spent_micros, reserved_micros)) from usage_ledger), 0) / 10000.0),
    'daily_cap_cents', 3000, 'owner_preview_extra_cents', 500, 'total_cap_cents', 20000);
$$;
revoke all on function public.ledger_reserve(text, uuid, bigint, boolean) from public, anon, authenticated;
revoke all on function public.ledger_settle(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.ledger_snapshot() from public, anon, authenticated;

-- ---------------------------------------------------------------- the receiver read function (CONTRACT §1.7)
-- What the receiver may see of one bridge row. Before deliver_at: sealed, and only with heads_up. No text, tone or length.
create or replace function public.receiver_view(b public.bridges) returns jsonb language sql stable as $$
  select case
    when b.status = 'withdrawn' or b.receiver_deleted_at is not null then null
    when now() < b.deliver_at then
      case when b.heads_up then jsonb_build_object('id', b.id, 'from', b.sender, 'sealed', true, 'ready', false,
                                                   'deliver_at', b.deliver_at, 'heads_up', true, 'opened_at', null, 'reply_to', b.reply_to)
           else null end
    when b.opened_at is null then
      jsonb_build_object('id', b.id, 'from', b.sender, 'sealed', false, 'ready', true, 'deliver_at', b.deliver_at, 'opened_at', null, 'reply_to', b.reply_to)
    else
      jsonb_build_object('id', b.id, 'from', b.sender, 'sealed', false, 'ready', false, 'deliver_at', b.deliver_at, 'opened_at', b.opened_at,
                         'final', b.final, 'used', b.used, 'bridged_mark', b.used = 'bridged',
                         'original', case when b.show_original then b.original else null end,
                         'tone', b.tone_bridged, 'reply_to', b.reply_to)
  end;
$$;

-- All bridges from one sender to the caller, as the receiver may see them. Blocked senders yield nothing.
create or replace function public.receiver_bridges(p_sender uuid)
returns setof jsonb language sql security definer stable set search_path = public as $$
  select receiver_view(b) from bridges b
  where b.receiver = auth.uid() and b.sender = p_sender
    and not exists (select 1 from blocks k where k.owner = auth.uid() and k.blocked = p_sender)
    and receiver_view(b) is not null
  order by b.deliver_at;
$$;

-- Open one bridge: only the receiver, only at or after deliver_at. Sets opened_at once. Raises 'sealed' before its time.
create or replace function public.open_bridge(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b bridges%rowtype;
begin
  select * into b from bridges where id = p_id and receiver = auth.uid() and status = 'scheduled' for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if now() < b.deliver_at then raise exception 'sealed' using errcode = 'P0001', detail = b.deliver_at::text; end if;
  if b.opened_at is null then update bridges set opened_at = now() where id = p_id returning * into b; end if;
  return receiver_view(b);
end $$;

-- The receiver's thread saw the sealed bubble (so a withdrawal is shown as "withdrew" rather than nothing).
create or replace function public.mark_heads_up_seen(p_sender uuid) returns void language sql security definer set search_path = public as $$
  update bridges set heads_up_seen_at = coalesce(heads_up_seen_at, now())
  where receiver = auth.uid() and sender = p_sender and status = 'scheduled' and heads_up and now() < deliver_at;
$$;

-- The receiver's own copy after delivery.
create or replace function public.receiver_delete_bridge(p_id uuid) returns void language sql security definer set search_path = public as $$
  update bridges set receiver_deleted_at = now() where id = p_id and receiver = auth.uid() and now() >= deliver_at;
$$;

-- Accept an invite by code: creates the link both ways and the prefs rows. The code itself is never listable.
create or replace function public.accept_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i invites%rowtype; me uuid := auth.uid(); l links%rowtype; a uuid; b uuid;
begin
  select * into i from invites where code = p_code and not revoked and expires_at > now() for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if i.owner = me then raise exception 'invalid' using errcode = 'P0001'; end if;
  a := least(i.owner, me); b := greatest(i.owner, me);
  if exists (select 1 from links where person_a = a and person_b = b) then raise exception 'conflict' using errcode = 'P0001'; end if;
  insert into links (person_a, person_b, invite_id) values (a, b, i.id) returning * into l;
  insert into link_prefs (owner, other) values (i.owner, me), (me, i.owner) on conflict do nothing;
  update invites set accepted_by = me, accepted_at = now() where id = i.id;
  insert into thread_events (person_a, person_b, type) values (me, i.owner, 'joined');
  return jsonb_build_object('link_id', l.id, 'person', i.owner);
end $$;

grant execute on function public.receiver_bridges(uuid), public.open_bridge(uuid), public.mark_heads_up_seen(uuid),
  public.receiver_delete_bridge(uuid), public.accept_invite(text) to authenticated;
revoke all on function public.receiver_view(public.bridges) from public, anon;
grant execute on function public.receiver_view(public.bridges) to authenticated;

-- ---------------------------------------------------------------- cross-table policies (after every table exists)
-- linked people may read each other's public card (name, color, photo, is_example)
create policy profiles_linked_read on public.profiles for select using (
  exists (select 1 from public.links l where l.status in ('active','removed') and
          ((l.person_a = auth.uid() and l.person_b = profiles.id) or (l.person_b = auth.uid() and l.person_a = profiles.id)))
);
-- shared areas are readable by a linked person when the owner turned sharing on for them
create policy beliefs_shared_read on public.beliefs for select using (
  status = 'confirmed' and exists (
    select 1 from public.link_prefs p where p.owner = beliefs.owner and p.other = auth.uid()
      and p.share_on and beliefs.area = any(p.share_areas))
);
create policy receipts_shared_read on public.receipts for select using (
  exists (select 1 from public.beliefs b join public.link_prefs p on p.owner = b.owner
          where b.id = receipts.belief_id and p.other = auth.uid() and p.share_on and p.share_quotes and b.area = any(p.share_areas))
);
