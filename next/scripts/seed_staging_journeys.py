#!/usr/bin/env python3
"""J1 (COO 21:20Z 16 Nov, d-all-journey-test-16nov Step 4): three fixture states on STAGING for QA's journey flows, and a reset.

    python3 next/scripts/seed_staging_journeys.py --dry-run [day1|week1|month1|all]   # print the SQL, touch nothing
    python3 next/scripts/seed_staging_journeys.py [day1|week1|month1|all]             # seed (default: all), staging only; sweeps first
    python3 next/scripts/seed_staging_journeys.py --reset [day1|week1|month1|all]      # the same: return each fixture to its state between runs

Fixture accounts (flagged account_kind 'test', fictional names and text only, sign in with POST /preview/login {persona}):
    day1    journeyday1    "Day One (test)"   a new account: a first-launch profile, no map, no conversation, no link.
    week1   journeyweek1   "Week One (test)"  one person joined (Rae), a few kennings with receipts, one bridge each way.
    month1  journeymonth1  "Month One (test)" three people (Teo partner, Ada friend, Noa coworker), many kennings with receipts and
                                              links, check-ins on, a draft, a scheduled bridge, a parked note, older conversations.
Companions are their own staging accounts (journeywk-rae, journeymo-teo, journeymo-ada, journeymo-noa), never shared between fixtures.
PSY 4d: week1 and month1 each also hold one sealed unopened card (a bridge to the owner, due in three days, heads-up on), one set-aside
item (a kenning rated Not me and kept) and one removed person (journeywk-sol, journeymo-ines: link 'removed', the owner's own removal
event, one scheduled bridge to them withdrawn). All invented adults; every word is test-written.

The seeds write rows directly: no model call, no AI cents, no hosted call. A reset deletes every row the fixture people own or
share (the generic sweep below finds each table that points at profiles, so a table added later is covered), then writes the
fixture again, so a second run starts from the same state as the first. Every run sweeps first, so seed and reset are one
action (--reset is accepted and means the same). Spend accounting (usage_ledger), billing and safety
records are kept. The reset refuses ids that are not flagged account_kind 'test' with a journey persona, so it can never reach a
real account (law 10). Refuses to run unless the loaded project is the staging one. Idempotent. Prints ids, never a key.
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

TERMS_VERSION = "2026-10-29"  # next/api/auth.ts
NS = uuid.UUID("5d0f2a0e-6a43-4c1f-9d6c-6a6f1c0e51b1")  # fixed namespace: the same fixture gives the same row ids every run
KEEP_TABLES = ("usage_ledger", "subscription_entitlements", "reports")  # money, billing and safety records stay through a reset

OWNERS = {  # state -> (persona, name, color)
    "day1": ("journeyday1", "Day One (test)", "#5B6FA8"),
    "week1": ("journeyweek1", "Week One (test)", "#3E7C6B"),
    "month1": ("journeymonth1", "Month One (test)", "#8A5A7A"),
}
COMPANIONS = {  # state -> [(persona, name, color, relationship the owner holds, relationship the companion holds)]
    "day1": [],
    "week1": [("journeywk-rae", "Rae (test)", "#B07A3E", "friend", "friend")],
    "month1": [("journeymo-teo", "Teo (test)", "#6B8A4E", "partner", "partner"),
               ("journeymo-ada", "Ada (test)", "#7A6BC9", "friend", "friend"),
               ("journeymo-noa", "Noa (test)", "#C0714F", "coworker", "coworker")],
}
REMOVED = {  # state -> (persona, name, color): a person the owner removed (PSY 4d: week1 and month1 each hold one removed or withdrawn person)
    "day1": None,
    "week1": ("journeywk-sol", "Sol (test)", "#9A7F4A"),
    "month1": ("journeymo-ines", "Ines (test)", "#4F8AA0"),
}
STATES = tuple(OWNERS)

# (wording, kind, type, area, mood, line said, days ago, map lines, keyword)
WEEK1_KENNINGS = [
    ("I go quiet when plans change.", "everyday", "how I tend to react", "relationships", "neutral",
     "When the plan changed last minute I just went quiet and said it was fine.", 5, ["relationships"], "quiet"),
    ("I do my best thinking on long walks.", "everyday", "something I believe is true", "meaning", "happy",
     "I sorted it all out on a long walk, I always do.", 4, ["meaning"], "walking"),
    ("I want my work to be seen by people I respect.", "foundation", "something I believe is true", "work", "excited",
     "What I want is for the people I respect to actually see the work.", 4, ["work"], "seen"),
    ("I say it's fine to keep the peace.", "rule", "a rule I live by", "relationships", "neutral",
     "I said it was fine again, it keeps the peace.", 3, ["relationships", "family"], "peace"),
]
MONTH1_KENNINGS = WEEK1_KENNINGS + [
    ("Rest has to be earned.", "foundation", "something I believe is true", "body", "sad",
     "I can't sit down until everything on the list is done.", 24, ["body"], "earned"),
    ("I remember small things people tell me.", "everyday", "something I believe is true", "relationships", "happy",
     "I remembered her cat's name from months ago and she lit up.", 22, ["relationships"], "remember"),
    ("I keep money worries to myself.", "rule", "a rule I live by", "money", "lonely",
     "I didn't tell anyone about the bill, I just handled it.", 21, ["money"], "private"),
    ("I need a plan before I can relax.", "rule", "something I do to cope", "meaning", "confused",
     "If I don't have a plan for the weekend I can't settle.", 19, ["meaning"], "plan"),
    ("Family dinners matter more than I say.", "foundation", "something I believe is true", "family", "happy",
     "The Sunday dinner is the part of the week I'd keep.", 17, ["family"], "dinners"),
    ("I over-explain when I feel judged.", "everyday", "how I tend to react", "work", "angry",
     "In the review I kept explaining and explaining.", 15, ["work"], "explain"),
    ("I like being the one who is calm.", "rule", "something I do to cope", "relationships", "neutral",
     "Somebody has to stay calm, so it's me.", 12, ["relationships"], "calm"),
    ("Mornings are mine.", "everyday", "a view or taste", "body", "happy",
     "I protect the first hour of the day, no phone.", 9, ["body"], "mornings"),
    ("Being useful is how I belong.", "foundation", "something I believe is true", "meaning", "lonely",
     "I feel like I'm only wanted when I'm useful.", 7, ["meaning", "relationships"], "useful"),
    ("I pull back when I'm tired.", "everyday", "how I tend to react", "relationships", "sad",
     "I was so tired I just pulled back from everyone this week.", 2, ["relationships"], "tired"),
]
# PSY 4d: one set-aside item per state, rated Not me and kept (law 3), not on the owner's map. Same row shape as WEEK1_KENNINGS.
SET_ASIDE = {
    "week1": ("I have to keep up with everyone.", "rule", "a rule I live by", "work", "sad",
              "I feel like I have to keep up with everyone around me.", 6, ["work"], "keepup"),
    "month1": ("I have to keep up with everyone.", "rule", "a rule I live by", "work", "sad",
               "I feel like I have to keep up with everyone around me.", 13, ["work"], "keepup"),
}
# (a index, b index, kind) for kenning_links; (a, b) for kenning_because
LINKS = [(0, 3, "both_true"), (1, 2, "both_true"), (3, 4, "comes_from")]
BECAUSE = [(3, 0)]
# comm items on month1: (kind, scope type, scope value, wording, statement, said)
COMM = [("how_i_mean", "everyone", None, "I mean it kindly when I joke about it.",
         "When I joke about something it is usually my way of saying it matters.", "I joke when it matters, it's how I say it."),
        ("bring_up", "type", "partner", "Bring things up in the evening, not the morning.",
         "Bring things up in the evening, not the morning.", "Please don't start the hard stuff before I've had my coffee.")]


def uid(*parts: str) -> str:
    return str(uuid.uuid5(NS, "/".join(parts)))


def state_personas(states) -> list[str]:
    """Every account the named fixtures use: owners, active companions, then removed people."""
    return ([OWNERS[s][0] for s in states] + [c[0] for s in states for c in COMPANIONS[s]]
            + [REMOVED[s][0] for s in states if REMOVED[s]])


def persona_ids() -> list[str]:
    return state_personas(STATES)


def profile_sql(q, pid: str, name: str, color: str, persona: str, default_settings) -> str:
    return (f"insert into profiles (id, name, color, is_example, is_practice, is_preview, persona, account_kind, auth_provider, adult_confirmed_at, terms_version, settings) values "
            f"({q(pid)}, {q(name)}, {q(color)}, false, false, false, {q(persona)}, 'test', 'preview', now(), {q(TERMS_VERSION)}, {q(default_settings)}) "
            f"on conflict (id) do update set name = excluded.name, color = excluded.color, is_example = false, is_practice = false, is_preview = false, "
            f"persona = excluded.persona, account_kind = 'test', auth_provider = 'preview', adult_confirmed_at = now(), terms_version = excluded.terms_version, "
            f"settings = excluded.settings, map_seen_at = null, map_delete_at = null, deleted_at = null;")


def link_sql(q, a: str, b: str, rel_a: str, rel_b: str, status: str = "active") -> list[str]:
    lo, hi = sorted((a, b))
    return [f"insert into links (person_a, person_b, status) values ({q(lo)}, {q(hi)}, {q(status)}) on conflict (person_a, person_b) do update set status = {q(status)};",
            f"insert into link_prefs (owner, other, relationship) values ({q(a)}, {q(b)}, {q(rel_a)}) on conflict (owner, other) do update set relationship = {q(rel_a)};",
            f"insert into link_prefs (owner, other, relationship) values ({q(b)}, {q(a)}, {q(rel_b)}) on conflict (owner, other) do update set relationship = {q(rel_b)};"]


def kennings_sql(q, state: str, owner: str, rows: list[tuple], start: int = 0, aside: bool = False) -> tuple[list[str], list[str]]:
    """A finished talk per kenning age bucket is overkill: one conversation per kenning keeps every receipt tied to its own message."""
    sql: list[str] = []
    ids: list[str] = []
    for i, (words, kind, btype, area, mood, said, days, lines, keyword) in enumerate(rows, start=start):
        conv, bel, msg = uid(state, "conv", str(i)), uid(state, "belief", str(i)), uid(state, "msg", str(i))
        ids.append(bel)
        sql.append(f"insert into conversations (id, owner, title, status, mode, started_at, last_active_at, finished_at, summary) values "
                   f"({q(conv)}, {q(owner)}, {q('Fixture talk ' + str(i + 1))}, 'finished', 'text', now() - interval '{days} days', now() - interval '{days} days', "
                   f"now() - interval '{days} days', 'A fixture talk (fictional).');")
        sql.append(f"insert into messages (id, conversation_id, owner, role, turn, text, feeling, created_at) values "
                   f"({q(msg)}, {q(conv)}, {q(owner)}, 'me', 1, {q(said)}, {q(mood)}, now() - interval '{days} days');")
        # a set-aside row is what a Not me rating leaves (api/map.ts): status set_aside, rating not, set_aside_at, the earlier state remembered
        st, rate, confirmed, aside_at, prev = ("'set_aside'", "'not'", "null", f"now() - interval '{days} days'", "'guess'") if aside else ("'confirmed'", "'very'", f"now() - interval '{days} days'", "null", "null")
        sql.append(f"insert into beliefs (id, owner, label, statement, type, kind, area, domains, birth_mood, status, rating, confidence, source, conversation_id, "
                   f"rated_at, confirmed_at, set_aside_at, previous_status, created_at, map_lines, map_keyword) values "
                   f"({q(bel)}, {q(owner)}, {q(words[:40])}, {q(words)}, {q(btype)}, {q(kind)}, {q(area)}, {q([area])}, {q(mood)}, {st}, {rate}, 0.85, 'talk', "
                   f"{q(conv)}, now() - interval '{days} days', {confirmed}, {aside_at}, {prev}, now() - interval '{days} days', {q(lines)}, {q(keyword)});")
        sql.append(f"insert into receipts (owner, belief_id, message_id, conversation_id, quote, said_at) values "
                   f"({q(owner)}, {q(bel)}, {q(msg)}, {q(conv)}, {q(said)}, now() - interval '{days} days');")
    return sql, ids


def bridge_sql(q, bid: str, sender: str, receiver: str, text: str, deliver: str, status: str = "scheduled", opened: bool = False,
               reply_to: str | None = None) -> str:
    opened_at = "now() - interval '1 hour'" if opened else "null"
    withdrawn_at = "now() - interval '3 days'" if status == "withdrawn" else "null"
    return (f"insert into bridges (id, sender, receiver, reply_to, original, bridged, final, used, outcome, deliver_at, tz, status, opened_at, withdrawn_at) values "
            f"({q(bid)}, {q(sender)}, {q(receiver)}, {q(reply_to)}, {q(text)}, null, {q(text)}, 'mine', 'ok', {deliver}, 'UTC', {q(status)}, {opened_at}, {withdrawn_at});")


def seed_one(q, state: str, ids: dict[str, str], default_settings) -> list[str]:
    persona, name, color = OWNERS[state]
    owner = ids[persona]
    sql = [profile_sql(q, owner, name, color, persona, default_settings)]
    comps = COMPANIONS[state]
    for cp, cname, ccolor, _, _ in comps:
        sql.append(profile_sql(q, ids[cp], cname, ccolor, cp, default_settings))
    for cp, _, _, rel_o, rel_c in comps:
        sql += link_sql(q, owner, ids[cp], rel_o, rel_c)
    gone = REMOVED[state]
    if gone:
        sql.append(profile_sql(q, ids[gone[0]], gone[1], gone[2], gone[0], default_settings))
    if state == "day1":
        return sql
    rows = WEEK1_KENNINGS if state == "week1" else MONTH1_KENNINGS
    k_sql, bels = kennings_sql(q, state, owner, rows)
    sql += k_sql
    for a, b, kind in LINKS:
        if max(a, b) >= len(bels):
            continue   # week1 has fewer kennings than month1
        sql.append(f"insert into kenning_links (owner, a_belief, b_belief, kind) values ({q(owner)}, {q(bels[a])}, {q(bels[b])}, {q(kind)}) on conflict do nothing;")
    a_sql, _ = kennings_sql(q, state, owner, [SET_ASIDE[state]], start=50, aside=True)
    sql += a_sql
    # PSY 4d: a person the owner removed. The link is 'removed', the removal event is the owner's own and invisible to the removed
    # person (QA-B403), and the one bridge the owner had scheduled to them was withdrawn silently (QA-B402).
    sql += link_sql(q, owner, ids[gone[0]], "friend", "friend", status="removed")
    sql.append(f"insert into thread_events (person_a, person_b, type, visible_to_b, created_at) values ({q(owner)}, {q(ids[gone[0]])}, 'removed', false, now() - interval '3 days');")
    sql.append(bridge_sql(q, uid(state, "bridge", "withdrawn"), owner, ids[gone[0]], "Can we catch up this weekend?", "now() + interval '1 day'", status="withdrawn"))
    if state == "week1":
        rae = ids["journeywk-rae"]
        sql.append(bridge_sql(q, uid(state, "bridge", "out"), owner, rae, "I've been quiet this week and it isn't about you.", "now() - interval '2 days'", opened=True))
        sql.append(bridge_sql(q, uid(state, "bridge", "in"), rae, owner, "No pressure at all, I'm around when you want a walk.", "now() - interval '1 day'"))
        # PSY 4d: one sealed, unopened card (heads_up on, so the owner sees the sealed bubble; the text stays hidden until it is due)
        sql.append(bridge_sql(q, uid(state, "bridge", "sealed"), rae, owner, "Something small I have been meaning to say about the walk.", "now() + interval '3 days'"))
        return sql
    # month1
    for a, b in BECAUSE:
        sql.append(f"insert into kenning_because (owner, a_belief, b_belief) values ({q(owner)}, {q(bels[a])}, {q(bels[b])}) on conflict do nothing;")
    # communication items (migration 0069): confirmed, kept on the owner's own map
    for j, (ckind, stype, sval, words, stmt, said) in enumerate(COMM):
        i = len(rows) + j
        conv, bel, msg = uid(state, "conv", str(i)), uid(state, "belief", str(i)), uid(state, "msg", str(i))
        days = 10 - j
        sql.append(f"insert into conversations (id, owner, title, status, mode, started_at, last_active_at, finished_at, summary) values "
                   f"({q(conv)}, {q(owner)}, {q('Fixture talk ' + str(i + 1))}, 'finished', 'text', now() - interval '{days} days', now() - interval '{days} days', "
                   f"now() - interval '{days} days', 'A fixture talk (fictional).');")
        sql.append(f"insert into messages (id, conversation_id, owner, role, turn, text, feeling, created_at) values "
                   f"({q(msg)}, {q(conv)}, {q(owner)}, 'me', 1, {q(said)}, 'neutral', now() - interval '{days} days');")
        sql.append(f"insert into beliefs (id, owner, label, statement, type, kind, area, domains, status, rating, confidence, source, conversation_id, rated_at, confirmed_at, "
                   f"created_at, own_wording, comm_kind, comm_scope_type, comm_scope_value, comm_status) values "
                   f"({q(bel)}, {q(owner)}, {q(words[:40])}, {q(stmt)}, 'something I believe is true', 'everyday', 'relationships', {q(['relationships'])}, 'confirmed', 'very', 0.85, "
                   f"'talk', {q(conv)}, now() - interval '{days} days', now() - interval '{days} days', now() - interval '{days} days', {q(words)}, {q(ckind)}, "
                   f"{q(stype)}, {q(sval)}, 'active');")
        sql.append(f"insert into receipts (owner, belief_id, message_id, conversation_id, quote, said_at) values "
                   f"({q(owner)}, {q(bel)}, {q(msg)}, {q(conv)}, {q(said)}, now() - interval '{days} days');")
    teo, ada, noa = (ids[c[0]] for c in comps)
    # older conversation history: two unfinished-then-finished talks with a Presence reply each, three weeks back
    for n, days in enumerate((27, 20)):
        conv = uid(state, "history", str(n))
        sql.append(f"insert into conversations (id, owner, title, status, mode, started_at, last_active_at, finished_at, summary) values "
                   f"({q(conv)}, {q(owner)}, {q('An older talk ' + str(n + 1))}, 'finished', 'text', now() - interval '{days} days', now() - interval '{days} days' + interval '6 minutes', "
                   f"now() - interval '{days} days' + interval '6 minutes', 'An older fixture talk (fictional).');")
        for turn, (role, text) in enumerate((("me", "Work was a lot this week and I barely saw anyone."),
                                              ("presence", "That sounds like a full week. What stayed with you most?"),
                                              ("me", "That I didn't mind being alone, which surprised me.")), start=1):
            sql.append(f"insert into messages (id, conversation_id, owner, role, turn, text, created_at) values "
                       f"({q(uid(state, 'history', str(n), str(turn)))}, {q(conv)}, {q(owner)}, {q(role)}, {turn}, {q(text)}, now() - interval '{days} days' + interval '{turn} minutes');")
    # check-ins on: weekly with the partner, fortnightly with the friend, one dated check-in with the coworker
    sql.append(f"insert into check_ins (owner, person, repeats, day, time, tz, status, accepted_at) values ({q(owner)}, {q(teo)}, 'weekly', 'sunday', '19:00', 'UTC', 'active', now() - interval '20 days') "
               f"on conflict (owner, person) do update set status = 'active', day = 'sunday', time = '19:00';")
    sql.append(f"insert into check_ins (owner, person, repeats, day, time, tz, status, accepted_at) values ({q(owner)}, {q(ada)}, 'fortnightly', 'thursday', '18:30', 'UTC', 'active', now() - interval '14 days') "
               f"on conflict (owner, person) do update set status = 'active', day = 'thursday', time = '18:30';")
    sql.append(f"insert into check_in_dates (owner, person, on_date, time, tz, status, accepted_at) values ({q(owner)}, {q(noa)}, current_date + 3, '12:00', 'UTC', 'active', now()) "
               f"on conflict (owner, person, on_date) do nothing;")
    # a draft to the coworker, a scheduled bridge to the friend, a delivered pair with the partner, a parked note about the partner
    sql.append(f"insert into drafts (owner, other, text) values ({q(owner)}, {q(noa)}, 'About Thursday: I would rather go through the plan together first.') "
               f"on conflict (owner, other) do update set text = excluded.text;")
    sql.append(bridge_sql(q, uid(state, "bridge", "scheduled"), owner, ada, "Can we move Thursday to the evening? Mornings are hard this week.", "now() + interval '1 day'"))
    sql.append(bridge_sql(q, uid(state, "bridge", "out"), owner, teo, "I want to talk about the weekend, nothing is wrong.", "now() - interval '9 days'", opened=True))
    sql.append(bridge_sql(q, uid(state, "bridge", "in"), teo, owner, "Thank you for telling me. Sunday works.", "now() - interval '8 days'", opened=True,
                          reply_to=uid(state, "bridge", "out")))
    sql.append(f"insert into parked_notes (writer, partner, text) values ({q(owner)}, {q(teo)}, 'Ask about the trip once the dust settles.');")
    # PSY 4d: one sealed, unopened card from the friend
    sql.append(bridge_sql(q, uid(state, "bridge", "sealed"), ada, owner, "I have a small thing to tell you about Thursday.", "now() + interval '3 days'"))
    return sql


def plan_sql(q, state: str, ids: dict[str, str], default_settings=None) -> str:
    """One transaction that writes one fixture. `ids` maps persona -> profile id. Pure: no database call."""
    default_settings = default_settings if default_settings is not None else {}
    return "\n".join(["begin;"] + seed_one(q, state, ids, default_settings) + ["commit;"])


def reset_sql(q, personas: list[str], ids: dict[str, str]) -> str:
    """One transaction that removes every row the named fixture people own or share (every table that points at profiles, found in
    the catalog, so a later table is covered), except money, billing and safety records. Refuses any id that is not a journey test
    account. The profile rows stay: the seed that follows rewrites them."""
    id_list = ", ".join(q(ids[p]) + "::uuid" for p in personas)
    keep = ", ".join(q(t) for t in KEEP_TABLES)
    return f"""begin;
do $reset$
declare
  fixture uuid[] := array[{id_list}];
  bad integer;
  fk record;
  pass integer;
  left_over integer;
begin
  select count(*) into bad from unnest(fixture) f(id)
    where not exists (select 1 from public.profiles p where p.id = f.id and p.account_kind = 'test' and p.persona like 'journey%');
  if bad > 0 then raise exception 'journey reset refused: % id(s) are not journey test accounts', bad; end if;
  for pass in 1..6 loop
    left_over := 0;
    for fk in
      select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and c.conrelid <> 'public.profiles'::regclass
        and (select relname from pg_class where oid = c.conrelid) not in ({keep})
    loop
      begin
        execute format('delete from %s where %I = any ($1)', fk.tbl, fk.col) using fixture;
      exception when foreign_key_violation then
        left_over := left_over + 1;   -- a child row still points here; the next pass removes it first
      end;
    end loop;
    exit when left_over = 0;
  end loop;
  if left_over > 0 then raise exception 'journey reset incomplete after 6 passes'; end if;
end
$reset$;
commit;"""


def scripts(q, states: list[str], ids: dict[str, str], default_settings, reset: bool) -> list[tuple[str, str]]:
    """The ordered SQL scripts of a run, (label, sql): the fixture profiles (the reset's guard reads them), the sweep if asked, then each fixture."""
    out: list[tuple[str, str]] = []
    personas = state_personas(states)
    rows = []
    for s in states:
        rows.append((OWNERS[s][0], OWNERS[s][1], OWNERS[s][2]))
        rows += [(c[0], c[1], c[2]) for c in COMPANIONS[s]]
        if REMOVED[s]:
            rows.append(REMOVED[s])
    out.append(("profiles", "begin;\n" + "\n".join(profile_sql(q, ids[p], n, c, p, default_settings) for p, n, c in rows) + "\ncommit;"))
    if reset:
        out.append(("reset", reset_sql(q, personas, ids)))
    out += [(f"seed {s}", plan_sql(q, s, ids, default_settings)) for s in states]
    return out


def main(argv: list[str]) -> int:
    dry, reset = "--dry-run" in argv, True   # seed and reset are one action: a seed that did not sweep would collide with its own earlier rows
    args = [a for a in argv if not a.startswith("--")]
    pick = args[0] if args else "all"
    if pick != "all" and pick not in STATES:
        print(f"unknown fixture {pick!r}; use day1, week1, month1 or all")
        return 2
    states = list(STATES) if pick == "all" else [pick]
    personas = state_personas(states)
    os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
    import seed_preview as sp  # noqa: E402
    if dry:
        for _, sql in scripts(sp.q, states, {p: f"<{p}>" for p in persona_ids()}, sp.DEFAULT_SETTINGS, reset):
            print(sql)
        return 0
    from staging_setup import STAGING, load as load_env  # noqa: E402
    from supabase_api import run_sql  # noqa: E402
    env = load_env(STAGING)
    if sp.load()["SUPABASE_PROJECT_REF"] != env["SUPABASE_PROJECT_REF"]:
        print("refusing: the loaded project is not the staging project")
        return 1
    ids = {p: sp.ensure_user(env, f"{p}@preview.presence.app", sp.preview_password(), p) for p in personas}
    for label, sql in scripts(sp.q, states, ids, sp.DEFAULT_SETTINGS, reset):
        code, body = run_sql(env, sql)
        print(label, code, "" if code in (200, 201) else str(body)[:300])
        if code not in (200, 201):
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
