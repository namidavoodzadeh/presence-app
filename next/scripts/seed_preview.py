#!/usr/bin/env python3
"""Seed the preview accounts on the hosted Supabase project (APP-V1-BUILD §3, NEXT 2026-10-27 item 2).

Creates six auth users and profiles: the owner's preview account "Nami" (no seeded beliefs: his map comes from
his own talks) and five example people, visibly `is_example`, each carrying one cast persona's hidden map as
confirmed beliefs with receipts (law 2: every belief has a quote in a seeded, finished conversation), linked to
Nami with the cast relationship, sharing two areas of their map with him so B16 has something to show.

Also seeds usage_ledger with every cent spent so far, one row per UTC day, from the SQLite ledger (read-only),
so the 20,000¢ total counts everything (NEXT item 3).

Also seeds the QA pair (COO check-in 2026-10-28 00:55, item 10): Sam (already an example, Nami's friend) and Jo (new,
cast persona joan-humorous-retirement), linked to each other as friends, each with a short finished Talk conversation
(three turns with Presence's replies) beside the cast map. Jo is never linked to Nami. The app lane's automated walks run
as sam ↔ jo; Nami ↔ Lea stay for the owner.

Re-runnable: example data is replaced; Nami's rows are only upserted (name, flags), never deleted.
No value from the secrets files is ever printed. Spends nothing.

    python3 next/scripts/seed_preview.py            # seed everything (Nami, the five examples, the QA pair)
    python3 next/scripts/seed_preview.py --qa-pair  # only Jo's account, the Sam ↔ Jo link and both short talks
    python3 next/scripts/seed_preview.py --dry-run  # print the plan (names, counts), no writes
"""
from __future__ import annotations

import json
import os
import secrets
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from supabase_env import load, load_for_step, default_path, service_headers  # noqa: E402
from supabase_api import run_sql  # noqa: E402

# persona slug → (display name, relationship to Nami, cast persona id, color)
EXAMPLES = {
    "lea":  ("Lea",  "partner",  "talia-contradictory-love",     "#7D6BC9"),
    "mom":  ("Mom",  "family",   "marin-verbose-work-family",    "#D9662E"),
    "sam":  ("Sam",  "friend",   "frank-humorous-society",       "#2E8B8B"),
    "ari":  ("Ari",  "coworker", "omar-emotional-work",          "#B5533C"),
    "dara": ("Dara", "friend",   "mei-nonnative-money",          "#5E7FB0"),
}
# The QA pair: Sam (above) and Jo. Jo takes a cast persona no example uses; linked to Sam only.
QA_PAIR = {"sam": EXAMPLES["sam"], "jo": ("Jo", "friend", "joan-humorous-retirement", "#8A6D3B")}
# Nami's hand-test pair (COO 13:50 10-31): two normal people (not is_example), linked only to each other
# as partners, empty maps, never linked to Nami or any example. slug -> (display name, color).
KAI_NOOR = {"kai": ("Kai", "#4A7A5C"), "noor": ("Noor", "#9C4F7E")}
SHORT_TALK_TITLE = "A short talk"
# Presence's side of the short talk: a reflection and a question per turn, descriptive, never an echo of the belief (A20/A32).
SHORT_TALK_REPLIES = [
    ("It sounds like that moment stayed with you longer than you expected.", "What was happening right before it?"),
    ("There is a lot in that, and you said it plainly.", "When did you first notice yourself doing that?"),
    ("It sounds like this comes up more than once.", "What do you usually do next?"),
]
TYPE_FOR_LEVEL = {"L0": "something I believe is true", "L1": "a rule I live by", "L2": "something I do to cope",
                  "L3": "a view or taste", "L4": "how I tend to react"}
KIND_FOR_TYPE = {"something I believe is true": "foundation", "a rule I live by": "rule", "something I do to cope": "rule",
                 "a view or taste": "everyday", "how I tend to react": "everyday"}
AREA_FOR_DOMAIN = {"close_relationships": "relationships", "work": "work", "body_health": "body", "money": "money",
                   "meaning": "meaning", "family": "family", "politics": "politics", "society": "politics", "morality": "morality"}
MOODS = ["lonely", "sad", "happy", "neutral", "confused", "excited", "angry"]
DEFAULT_SETTINGS = {
    "voice_turns": "send_on_pause", "read_aloud": True, "start_in": "voice", "bridge_tonight": "20:00", "bridge_tomorrow": "20:00",
    "heads_up_default": True, "show_original_default": False, "read_receipts": True, "keep_archived": False,
    "frost": True, "frost_after_seconds": 30,
    "notify": {"bridges_ready": True, "talk_reminders": True, "mirror": True, "talk_replies": True, "previews": False},
    "server": "hosted",
}
FUNCTION_WORDS = {"a", "an", "the", "to", "of", "in", "on", "at", "for", "and", "or", "is", "are", "be", "can", "my", "me", "i",
                  "it", "its", "than", "that", "this", "when", "with", "as", "by", "from"}


def area_for(domains: list[str]) -> str:
    for d in domains:
        if d in AREA_FOR_DOMAIN:
            return AREA_FOR_DOMAIN[d]
    return "meaning"


def label_for(statement: str) -> str:
    words = [w.strip(".,;:!?\"'") for w in statement.split()]
    if words and words[0].lower() in ("i", "i'm", "i'd", "i'll"):
        words = words[1:]
    words = words[:4]
    while words and words[-1].lower() in FUNCTION_WORDS:
        words.pop()
    if not words:
        words = statement.split()[:2]
    return (" ".join(words))[:1].upper() + (" ".join(words))[1:]


def q(v) -> str:
    """SQL literal."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (list, tuple)):
        return "array[" + ",".join(q(x) for x in v) + "]::text[]" if v else "'{}'::text[]"
    if isinstance(v, dict):
        return q(json.dumps(v)) + "::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


def preview_password() -> str:
    path = default_path().with_name("presence-preview.env")
    if path.exists():
        for line in path.read_text().splitlines():
            if line.startswith("PRESENCE_PREVIEW_PASSWORD="):
                v = line.split("=", 1)[1].strip()
                if v:
                    return v
    value = secrets.token_urlsafe(24)
    path.write_text(f"PRESENCE_PREVIEW_PASSWORD={value}\n")
    os.chmod(path, 0o600)
    return value


def auth_call(env: dict[str, str], method: str, path: str, body=None) -> tuple[int, dict | list]:
    req = urllib.request.Request(env["SUPABASE_URL"] + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    for name, value in service_headers(env).items():
        req.add_header(name, value)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:  # noqa: BLE001
            return e.code, {}


def ensure_user(env: dict[str, str], email: str, password: str, persona: str) -> str:
    code, body = auth_call(env, "POST", "/auth/v1/admin/users",
                           {"email": email, "password": password, "email_confirm": True, "user_metadata": {"persona": persona}})
    if code in (200, 201) and isinstance(body, dict) and body.get("id"):
        return body["id"]
    # exists: find it, then reset its password to the current preview password
    code, body = auth_call(env, "GET", "/auth/v1/admin/users?page=1&per_page=200")
    users = body.get("users", []) if isinstance(body, dict) else []
    for u in users:
        if u.get("email") == email:
            auth_call(env, "PUT", f"/auth/v1/admin/users/{u['id']}", {"password": password, "user_metadata": {"persona": persona}})
            return u["id"]
    raise SystemExit(f"could not create or find user for {persona} (auth {code})")


def ledger_days() -> list[tuple[str, int]]:
    root = Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome"))
    path = Path(os.environ.get("PRESENCE_LEDGER_DB", root / "runtime/private-phone/presence-live.sqlite3"))
    if not path.exists():
        return []
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    tables = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
    totals: dict[str, int] = {}
    for t in ("generation_drafts", "bridge_paid_calls", "next_engine_calls"):
        if t not in tables:
            continue
        for day, micros in db.execute(f"select substr(created_at,1,10), sum(spent) from {t} where spent is not null group by 1"):
            totals[day] = totals.get(day, 0) + int(micros)
    return sorted(totals.items())


def profile_sql(uid: str, name: str, color: str, slug: str, is_practice: bool = True) -> str:
    # E24 (C) remainder: `is_practice` is distinct from `is_example` (migration 0030). Jo (the QA pair's other
    # half) is `is_example` like the rest of the cast but never linked to Nami, so it is never part of his
    # "Practice" label; every slug seeded here as an owner-facing cast member keeps the true default.
    practice = "true" if is_practice else "false"
    return (f"insert into profiles (id, name, color, is_example, is_practice, is_preview, persona, settings) values "
            f"({q(uid)}, {q(name)}, {q(color)}, true, {practice}, true, {q(slug)}, {q(DEFAULT_SETTINGS)}) "
            f"on conflict (id) do update set name = excluded.name, color = excluded.color, is_example = true, "
            f"is_practice = {practice}, is_preview = true, persona = excluded.persona;")


def seed_cast_map(sql: list[str], uid: str, name: str, p: dict, pid: str) -> list[str]:
    """The persona's hidden map as confirmed beliefs with receipts in one seeded, finished conversation. Returns the areas seen, in order."""
    sql.append(f"insert into conversations (owner, title, status, mode, started_at, last_active_at, finished_at, summary) values "
               f"({q(uid)}, {q('Example: ' + name)}, 'finished', 'text', now() - interval '3 days', now() - interval '3 days', now() - interval '3 days', "
               f"{q('Seeded from the test cast persona ' + pid + ' (fictional).')});")
    conv = f"(select id from conversations where owner = {q(uid)} and title = {q('Example: ' + name)} order by created_at desc limit 1)"
    areas_seen: list[str] = []
    local_ids: dict[str, str] = {}
    for i, b in enumerate(p["beliefs"]):
        btype = TYPE_FOR_LEVEL[b["level"]]
        kind = KIND_FOR_TYPE[btype]
        area = area_for(b["domains"])
        if area not in areas_seen:
            areas_seen.append(area)
        mood = MOODS[i % len(MOODS)]
        rating = "partly" if i % 4 == 3 else "very"
        label = label_for(b["statement"])
        evidence = b["evidence"]
        turn = i + 1
        sql.append(f"insert into messages (conversation_id, owner, role, turn, text, feeling, created_at) values "
                   f"({conv}, {q(uid)}, 'me', {turn}, {q(evidence)}, {q(mood)}, now() - interval '3 days' + interval '{turn} minutes');")
        sql.append(f"insert into beliefs (owner, label, statement, type, kind, level, area, domains, birth_mood, status, rating, confidence, source, conversation_id, rated_at, confirmed_at, created_at) values "
                   f"({q(uid)}, {q(label)}, {q(b['statement'])}, {q(btype)}, {q(kind)}, {q(b['level'])}, {q(area)}, {q(b['domains'])}, {q(mood)}, 'confirmed', {q(rating)}, 0.85, 'talk', "
                   f"{conv}, now() - interval '3 days', now() - interval '3 days', now() - interval '3 days' + interval '{turn} minutes');")
        bsel = f"(select id from beliefs where owner = {q(uid)} and statement = {q(b['statement'])} order by created_at desc limit 1)"
        msel = f"(select id from messages where owner = {q(uid)} and conversation_id = {conv} and turn = {turn} and role = 'me' limit 1)"
        sql.append(f"insert into receipts (owner, belief_id, message_id, conversation_id, quote, said_at) values "
                   f"({q(uid)}, {bsel}, {msel}, {conv}, {q(evidence)}, now() - interval '3 days');")
        local_ids[b["id"]] = bsel
    for e in p.get("edges", []):
        if e["from"] in local_ids and e["to"] in local_ids:
            kind = {"supports": "holds_up", "derives_from": "rests_on", "conflicts_with": "tension"}.get(e["type"])
            if kind:
                sql.append(f"insert into belief_links (owner, from_belief, to_belief, kind) values ({q(uid)}, {local_ids[e['from']]}, {local_ids[e['to']]}, {q(kind)}) on conflict do nothing;")
    return areas_seen


def seed_short_talk(sql: list[str], uid: str, p: dict) -> None:
    """A short finished Talk conversation (three of the persona's lines, each answered by Presence), replaced on every run.
    The presence rows carry the reply shape the app reads (state turn, move follow, no cards, no consent)."""
    sql.append(f"delete from conversations where owner = {q(uid)} and title = {q(SHORT_TALK_TITLE)};")   # messages cascade
    sql.append(f"insert into conversations (owner, title, status, mode, started_at, last_active_at, finished_at, summary) values "
               f"({q(uid)}, {q(SHORT_TALK_TITLE)}, 'finished', 'text', now() - interval '1 day', now() - interval '1 day' + interval '6 minutes', now() - interval '1 day' + interval '6 minutes', "
               f"{q('A short seeded talk for the QA walks (fictional).')});")
    conv = f"(select id from conversations where owner = {q(uid)} and title = {q(SHORT_TALK_TITLE)} order by created_at desc limit 1)"
    for i, (reflection, question) in enumerate(SHORT_TALK_REPLIES):
        turn = i + 1
        line = p["beliefs"][i]["evidence"]
        mood = MOODS[(i * 2) % len(MOODS)]
        sql.append(f"insert into messages (conversation_id, owner, role, turn, text, feeling, created_at) values "
                   f"({conv}, {q(uid)}, 'me', {turn}, {q(line)}, {q(mood)}, now() - interval '1 day' + interval '{2 * turn} minutes');")
        msel = f"(select id from messages where owner = {q(uid)} and conversation_id = {conv} and turn = {turn} and role = 'me' limit 1)"
        reply = {"ref": None, "move": {"kind": "follow"}, "turn": turn, "cards": [], "state": "turn", "safety": None, "consent": None,
                 "feeling": mood, "question": question, "message_id": None, "reflection": reflection, "early_guess": None}
        reply_sql = q(reply) + f" || jsonb_build_object('message_id', {msel})"
        sql.append(f"insert into messages (conversation_id, owner, role, turn, text, reply, created_at) values "
                   f"({conv}, {q(uid)}, 'presence', {turn}, {q(reflection + ' ' + question)}, {reply_sql}, now() - interval '1 day' + interval '{2 * turn} minutes 20 seconds');")


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    only_qa = "--qa-pair" in argv
    if "--production" in argv and not only_qa:
        print("seed_preview: --production is allowed only with --qa-pair (preview personas Sam and Jo)"); return 2
    env = load_for_step("seed_preview_pair") if "--production" in argv else load()
    personas = {p["id"]: p for p in json.loads((ROOT / "next/fixtures/personas.json").read_text())["personas"]}
    password = None if dry else preview_password()
    ids: dict[str, str] = {}
    for slug in (["sam", "jo"] if only_qa else ["nami", *EXAMPLES, "jo", *KAI_NOOR]):
        email = f"{slug}@preview.presence.app"
        ids[slug] = f"<{slug}>" if dry else ensure_user(env, email, password, slug)
    sql: list[str] = ["begin;"]
    # profiles
    if not only_qa:
        sql.append(f"insert into profiles (id, name, color, is_example, is_preview, persona, settings) values "
                   f"({q(ids['nami'])}, 'Nami', '#D9662E', false, true, 'nami', {q(DEFAULT_SETTINGS)}) "
                   f"on conflict (id) do update set is_preview = true, persona = 'nami';")
        # Nami's hand-test pair: normal people, upserted only (name/color/flags), never reset, so hand-test data stays.
        for slug, (name, color) in KAI_NOOR.items():
            sql.append(f"insert into profiles (id, name, color, is_example, is_preview, persona, settings) values "
                       f"({q(ids[slug])}, {q(name)}, {q(color)}, false, true, {q(slug)}, {q(DEFAULT_SETTINGS)}) "
                       f"on conflict (id) do update set name = excluded.name, color = excluded.color, is_preview = true, persona = excluded.persona;")
        a, b_ = sorted([ids["kai"], ids["noor"]])
        sql.append(f"insert into links (person_a, person_b, status) values ({q(a)}, {q(b_)}, 'active') on conflict (person_a, person_b) do update set status = 'active';")
        for owner, other in ((ids["kai"], ids["noor"]), (ids["noor"], ids["kai"])):
            sql.append(f"insert into link_prefs (owner, other, relationship) values ({q(owner)}, {q(other)}, 'partner') "
                       f"on conflict (owner, other) do update set relationship = excluded.relationship;")
    counts: dict[str, int] = {}
    for slug, (name, rel, pid, color) in EXAMPLES.items():
        if only_qa:
            break
        p = personas[pid]
        uid = ids[slug]
        sql.append(profile_sql(uid, name, color, slug))
        # replace example data
        for t in ("belief_links", "receipts", "beliefs", "messages", "conversations", "consent", "drafts"):
            sql.append(f"delete from {t} where owner = {q(uid)};")
        areas_seen = seed_cast_map(sql, uid, name, p, pid)
        counts[name] = len(p["beliefs"])
        # link with Nami, both prefs rows; the example shares its first two areas with Nami
        a, b_ = sorted([ids["nami"], uid]) if not dry else (ids["nami"], uid)
        sql.append(f"insert into links (person_a, person_b, status) values ({q(a)}, {q(b_)}, 'active') on conflict (person_a, person_b) do update set status = 'active';")
        sql.append(f"insert into link_prefs (owner, other, relationship) values ({q(ids['nami'])}, {q(uid)}, {q(rel)}) on conflict (owner, other) do update set relationship = excluded.relationship;")
        sql.append(f"insert into link_prefs (owner, other, relationship, share_on, share_areas, share_quotes) values ({q(uid)}, {q(ids['nami'])}, {q(rel)}, true, {q(areas_seen[:2])}, false) "
                   f"on conflict (owner, other) do update set relationship = excluded.relationship, share_on = true, share_areas = excluded.share_areas;")
    # the QA pair: Jo's account and cast map (replaced), the Sam ↔ Jo link, a short talk for both (replaced)
    jo_name, jo_rel, jo_pid, jo_color = QA_PAIR["jo"]
    sql.append(profile_sql(ids["jo"], jo_name, jo_color, "jo", is_practice=False))
    for t in ("belief_links", "receipts", "beliefs", "messages", "conversations", "consent", "drafts"):
        sql.append(f"delete from {t} where owner = {q(ids['jo'])};")
    jo_areas = seed_cast_map(sql, ids["jo"], jo_name, personas[jo_pid], jo_pid)
    counts[jo_name] = len(personas[jo_pid]["beliefs"])
    sam_areas = [area_for(b["domains"]) for b in personas[EXAMPLES["sam"][2]]["beliefs"]]
    sam_areas = list(dict.fromkeys(sam_areas))
    a, b_ = sorted([ids["sam"], ids["jo"]]) if not dry else (ids["sam"], ids["jo"])
    sql.append(f"insert into links (person_a, person_b, status) values ({q(a)}, {q(b_)}, 'active') on conflict (person_a, person_b) do update set status = 'active';")
    for owner, other, areas in ((ids["sam"], ids["jo"], sam_areas[:2]), (ids["jo"], ids["sam"], jo_areas[:2])):
        sql.append(f"insert into link_prefs (owner, other, relationship, share_on, share_areas, share_quotes) values ({q(owner)}, {q(other)}, 'friend', true, {q(areas)}, false) "
                   f"on conflict (owner, other) do update set relationship = 'friend', share_on = true, share_areas = excluded.share_areas, cleared_at = null, unread = false;")
    for slug, pid in (("sam", EXAMPLES["sam"][2]), ("jo", jo_pid)):
        seed_short_talk(sql, ids[slug], personas[pid])
    # ledger seed: every cent spent before this API existed, one row per UTC day
    days = ledger_days()
    if only_qa:
        days = []
    total_micros = sum(m for _, m in days)
    if not only_qa:
        sql.append("delete from usage_ledger where kind = 'seed:sqlite';")
    for day, micros in days:
        sql.append(f"insert into usage_ledger (utc_day, kind, reserved_micros, spent_micros, model, receipt, settled_at) values "
                   f"({q(day)}, 'seed:sqlite', {micros}, {micros}, 'mixed', {q('presence-live.sqlite3 ' + day)}, now());")
    sql.append("commit;")
    script = "\n".join(sql)
    print(f"plan: users {list(ids)}; example beliefs {counts}; ledger seed {len(days)} days, {total_micros / 10000:.2f}¢ total; sql {len(script)} chars")
    if dry:
        return 0
    code, body = run_sql(env, script)
    print("seed", code, body[:400])
    if code not in (200, 201):
        return 1
    code, body = run_sql(env, "select (select count(*) from profiles) profiles, (select count(*) from beliefs) beliefs, (select count(*) from receipts) receipts, "
                              "(select count(*) from links) links, (select count(*) from belief_links) belief_links, "
                              "(select ceil(sum(spent_micros)/10000.0) from usage_ledger) ledger_cents, (select ledger_snapshot()) snapshot")
    print("after", code, body[:600])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
