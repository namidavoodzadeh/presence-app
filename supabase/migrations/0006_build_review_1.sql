-- 0006_build_review_1 (engine lane, 2026-10-27; the CDO's build review 1, docs/design/v1/BUILD-REVIEW-1-CDO-ANSWERS.md, COO 15:45 Tehran).
--   profiles.tz                   the person's IANA time zone (R3 Q7: "8:00 PM for Lea", "late at night for Lea"); set by PATCH /me or
--                                 from the app's X-Presence-TZ header when still unknown. Linked people may read it (profiles_linked_read).
--   bridges.remind_at             the receiver's "Remind me later" on a ready bridge (B10c): per viewer, never shown to the sender; the app
--                                 schedules its local notification from it. Written only through remind_bridge() (the receiver has no policy).
--   receiver_view()               bridged_mark is false when nothing changed (Q4: the sent bubble carries no bridged mark for
--                                 nothing_to_change); the receiver's own remind_at rides on the ready view.
--   mirror_contributions.how_long the contributor's "For how long?" answer (W02), stored beside how_known; it weighs nothing yet.
alter table public.profiles add column if not exists tz text;
alter table public.bridges add column if not exists remind_at timestamptz;
alter table public.mirror_contributions add column if not exists how_long text check (how_long in ('under_a_year','one_to_five_years','over_five_years'));

-- Preview cast zones, so the owner sees the receiver's-time line while trying Bridge (example data; the owner's own zone comes from his app).
update public.profiles set tz = 'Europe/Berlin' where persona = 'lea' and tz is null;
update public.profiles set tz = 'America/Los_Angeles' where persona = 'sam' and tz is null;
update public.profiles set tz = 'Asia/Tehran' where persona in ('mom','ari','dara') and tz is null;

create or replace function public.receiver_view(b public.bridges) returns jsonb language sql stable as $$
  select case
    when b.status = 'withdrawn' or b.receiver_deleted_at is not null then null
    when now() < b.deliver_at then
      case when b.heads_up then jsonb_build_object('id', b.id, 'from', b.sender, 'sealed', true, 'ready', false,
                                                   'deliver_at', b.deliver_at, 'heads_up', true, 'opened_at', null, 'reply_to', b.reply_to)
           else null end
    when b.opened_at is null then
      jsonb_build_object('id', b.id, 'from', b.sender, 'sealed', false, 'ready', true, 'deliver_at', b.deliver_at, 'opened_at', null, 'reply_to', b.reply_to,
                         'remind_at', b.remind_at)
    else
      jsonb_build_object('id', b.id, 'from', b.sender, 'sealed', false, 'ready', false, 'deliver_at', b.deliver_at, 'opened_at', b.opened_at,
                         'final', b.final, 'used', b.used, 'bridged_mark', (b.used = 'bridged' and b.outcome is distinct from 'nothing_to_change'),
                         'original', case when b.show_original then b.original else null end,
                         'tone', b.tone_bridged, 'reply_to', b.reply_to)
  end;
$$;

-- Remind me later: only the receiver, only on a ready (delivered, unopened) bridge. null clears it. Returns the receiver view.
create or replace function public.remind_bridge(p_id uuid, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b bridges%rowtype;
begin
  select * into b from bridges where id = p_id and receiver = auth.uid() and status = 'scheduled' for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if now() < b.deliver_at then raise exception 'sealed' using errcode = 'P0001', detail = b.deliver_at::text; end if;
  if b.opened_at is not null then raise exception 'conflict' using errcode = 'P0001'; end if;
  if p_at is not null and p_at <= now() then raise exception 'invalid' using errcode = 'P0001'; end if;
  update bridges set remind_at = p_at where id = p_id returning * into b;
  return receiver_view(b);
end $$;
grant execute on function public.remind_bridge(uuid, timestamptz) to authenticated;
