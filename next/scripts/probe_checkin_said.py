#!/usr/bin/env python3
"""Live probe of v1.63 (migration 0055) and v1.64 (migration 0056, the 'Nothing else' done_bringing mark) as namitest/jantest (flagged test accounts): the text-free 'said' mark and
Session.first on the shared check-in session, and Card.closed_in_check_in (v1.65: also from a parked bridge's note; v1.68: only a note brought into the open session, a kept note not brought changes nothing on the other side). Never prints a secret or a token.

    python3 next/scripts/probe_checkin_said.py            # staging
    python3 next/scripts/probe_checkin_said.py --hosted   # production, only after Nami's yes

Fictional rows only (an accepted check-in jantest -> namitest, so namitest accepted and goes first; a check-in the other
way accepted later is left as it is; one kept note each);
all removed at the end. One existing delivered card between the two is closed during the session and its card state
is put back exactly as it was.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request, urllib.error, uuid
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
HOSTED = "--hosted" in sys.argv
if not HOSTED:
    os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
from supabase_api import run_sql  # noqa: E402
from supabase_env import load_for_step  # noqa: E402

env = load_for_step("seed_test_contact")
BASE = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
secret_file = Path.home() / "Library/Application Support/PresenceHome/secrets/preview-device.env"
secret = None
if not HOSTED:
    m = re.search(r"^PRESENCE_PREVIEW_DEVICE_SECRET=(\S+)", (Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome")) / "secrets/staging.env").read_text(), re.M)
    secret = m.group(1) if m else None
elif secret_file.exists():
    m = re.search(r"^(?:export\s+)?PRESENCE_PREVIEW_DEVICE_SECRET=[\"']?([^\"'\s]+)", secret_file.read_text(), re.M)
    secret = m.group(1) if m else None
results: list[tuple[str, bool, str]] = []

def call(method, path, body=None, token=None):
    h = {"content-type": "application/json", "apikey": env.get("SUPABASE_ANON_KEY", "")}
    if token: h["authorization"] = "Bearer " + token
    if secret and path == "/preview/login": h["x-presence-preview-secret"] = secret
    req = urllib.request.Request(BASE + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail)); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))

def login(p):
    s, j = call("POST", "/preview/login", {"persona": p})
    return str(j.get("access_token", "")), str(((j.get("me") or {}).get("person") or {}).get("id", "")), s

nt, nid, s1 = login("namitest"); jt, jid, s2 = login("jantest")
check("login namitest/jantest", nt and jt and nid and jid, f"{s1}/{s2}")
if not (nt and jt): sys.exit(1)
def sql(q):
    st, body = run_sql(env, q)
    try: return st, json.loads(body) if isinstance(body, str) else body
    except ValueError: return st, body
nk, jk, ciid, bk, bj = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
note_card = None
sql(f"delete from checkin_sessions where person_a in ('{nid}','{jid}') and person_b in ('{nid}','{jid}')")
# an existing jantest -> namitest check-in (e.g. probe_checkin_session's) is used as it is and never deleted
code, made = sql(f"insert into check_ins (id, owner, person, day, time, tz, status, accepted_at) values ('{ciid}', '{jid}', '{nid}', 'sunday', '10:00', 'UTC', 'active', now()) on conflict (owner, person) do nothing returning id")
# A check-in the other way may also exist (hosted's test pair has both). The API's firstSpeaker picks the one accepted
# earliest (check_ins rows are all repeating; then the smaller person id); the probe needs that one to be jantest -> namitest.
_, earliest = sql(f"select person from check_ins where status = 'active' and ((owner = '{jid}' and person = '{nid}') or (owner = '{nid}' and person = '{jid}')) "
                  f"order by coalesce(accepted_at, created_at)::text, person::text limit 1")
both = sql(f"select count(*)::int as n from check_ins where status = 'active' and owner = '{nid}' and person = '{jid}'")[1]
check("accepted check-in jantest -> namitest decides who goes first", code in (200, 201) and earliest and str(earliest[0].get("person")) == nid,
      f"{code} {'new' if made else 'existing'}; other way active: {(both[0] or {}).get('n') if both else '?'}")
sql(f"insert into parked_notes (id, writer, partner, text, state) values ('{nk}','{nid}','{jid}','Probe: I like planning ahead','later'),('{jk}','{jid}','{nid}','Probe: I need some quiet','later')")
card_id = None
try:
    s, j = call("POST", f"/checkin/{nid}/session", {}, jt); sess = j.get("session") or {}; sid = sess.get("id", "")
    check("jantest opens; first is namitest (accepted the invite)", s == 200 and sess.get("first") == nid, f"{s}")
    s, j = call("GET", f"/checkin/{jid}/session", token=nt)
    check("namitest reads the same first", s == 200 and (j.get("session") or {}).get("first") == nid, f"{s}")
    s, j = call("PUT", f"/checkin/session/{sid}/said", None, jt)
    check("jantest's mark before namitest's: not_your_turn", s == 409 and "not_your_turn" in json.dumps(j), f"{s}")
    s, j = call("PUT", f"/checkin/session/{sid}/said", None, nt)
    check("namitest said: mark in, still appreciations, no words", s == 200 and j["session"]["mine"]["said"] is True and j["session"]["phase"] == "appreciations" and j["session"]["mine"]["appreciation"] is None, f"{s}")
    s, j = call("GET", f"/checkin/{nid}/session", token=jt)
    check("jantest sees namitest's mark (no words)", s == 200 and j["session"]["theirs"]["said"] is True and j["session"]["theirs"]["appreciation"] is None, f"{s}")
    s, j = call("PUT", f"/checkin/session/{sid}/said", None, nt)
    check("second mark refused: already_given", s == 409 and "already_given" in json.dumps(j), f"{s}")
    s, j = call("PUT", f"/checkin/session/{sid}/said", None, jt)
    check("jantest said: phase items", s == 200 and j["session"]["phase"] == "items", f"{s}")
    _, parts = sql(f"select count(*) filter (where appreciation is not null) as words, count(*) filter (where said_at is not null) as marks from checkin_session_parts where session = '{sid}'")
    check("no words stored, two marks", isinstance(parts, list) and parts and int(parts[0]["words"]) == 0 and int(parts[0]["marks"]) == 2, str(parts)[:80])
    # v1.64 done_bringing ('Nothing else'): text-free, both phones read the same fact
    s, j = call("PUT", f"/checkin/session/{sid}/items/{nk}", {"bring": True}, nt)
    check("namitest brings one; not done yet", s == 200 and j["session"]["mine"]["done_bringing"] is False and j["session"]["mine"]["can_bring_more"] is True, f"{s}")
    s, j = call("GET", f"/checkin/{nid}/session", token=jt)
    check("jantest: namitest still choosing", s == 200 and j["session"]["theirs"]["done_bringing"] is False, f"{s}")
    s, j = call("PUT", f"/checkin/session/{sid}/done_bringing", None, nt)
    check("namitest Nothing else: done, can't bring more", s == 200 and j["session"]["mine"]["done_bringing"] is True and j["session"]["mine"]["can_bring_more"] is False, f"{s}")
    s, j = call("GET", f"/checkin/{nid}/session", token=jt)
    th = (j.get("session") or {}).get("theirs") or {}
    check("jantest sees namitest done, no count or eligible list", s == 200 and th.get("done_bringing") is True and sorted(th) == ["appreciation", "brought", "done_bringing", "said"], f"{s} {sorted(th)}")
    s, j = call("PUT", f"/checkin/session/{sid}/items/{nk}", {"bring": False}, nt)
    check("taking back still works after Nothing else", s == 200 and j["session"]["mine"]["brought"] == [] and j["session"]["mine"]["done_bringing"] is True, f"{s}")
    s, j = call("PUT", f"/checkin/session/{sid}/items/{nk}", {"bring": True}, nt)
    check("bringing after Nothing else: done_bringing", s == 409 and "done_bringing" in json.dumps(j), f"{s}")
    # v1.67 (Q-ENG-THEIRS-STATE): jantest's mark on what jantest brought reaches namitest's phone, no words or time
    s, j = call("PUT", f"/checkin/session/{sid}/items/{jk}", {"bring": True}, jt)
    check("jantest brings one: mine.brought state parked", s == 200 and [n.get("state") for n in j["session"]["mine"]["brought"]] == ["parked"], f"{s}")
    s, j = call("GET", f"/checkin/{jid}/session", token=nt)
    tb = j["session"]["theirs"]["brought"] if s == 200 else []
    check("namitest sees it parked, text and state only", s == 200 and len(tb) == 1 and tb[0].get("state") == "parked" and sorted(tb[0]) == ["state", "text"], f"{s} {tb}")
    s, _ = call("PATCH", f"/checkin/notes/{jk}", {"state": "later"}, jt)
    s2, j = call("GET", f"/checkin/{jid}/session", token=nt)
    check("jantest marks Next week: namitest sees later", s == 200 and s2 == 200 and [n.get("state") for n in j["session"]["theirs"]["brought"]] == ["later"], f"{s}/{s2}")
    s, _ = call("PATCH", f"/checkin/notes/{jk}", {"state": "talked"}, jt)
    s2, j = call("GET", f"/checkin/{jid}/session", token=nt)
    check("jantest marks Talked about it: namitest sees talked", s == 200 and s2 == 200 and [n.get("state") for n in j["session"]["theirs"]["brought"]] == ["talked"], f"{s}/{s2}")
    # Card.closed_in_check_in: one delivered card between them, closed while the session is open
    s, j = call("GET", f"/cards/{jid}", token=nt)
    # only a delivered card never marked by anyone (no bridge_cards row), so putting it back is deleting the probe's row
    cands = [c for c in (j.get("cards") or []) if c.get("delivered") and c.get("state") == "open" and c.get("state_by") is None]
    check("GET /cards carries closed_in_check_in", s == 200 and all("closed_in_check_in" in c for c in (j.get("cards") or []) + (j.get("closed") or [])), f"{s} {len(cands)} cards")
    if cands:
        card_id = cands[0]["bridge_id"]
        s, j = call("PATCH", f"/cards/{card_id}", {"state": "talked"}, nt)
        check("closed during the session: closed_in_check_in true", s == 200 and j["card"]["closed_in_check_in"] is True, f"{s}")
        s, j = call("GET", f"/cards/{nid}", token=jt)
        row = [c for c in j.get("closed") or [] if c["bridge_id"] == card_id]
        check("jantest reads it on closed[]", s == 200 and row and row[0]["closed_in_check_in"] is True, f"{s}")
    # v1.68 guard (CPO 12 Nov 22:40Z (2)) and v1.65 (Q-APP-V3-22), while the session is open, on one delivered card
    # namitest sent that nobody has marked: namitest's kept note on it, NOT brought, marked talked changes only namitest's
    # list; jantest's note on the same card, brought, marked talked closes the card for both, tagged 'At the check-in'.
    s, j = call("GET", f"/cards/{jid}", token=nt)
    sent = [c for c in (j.get("cards") or []) if c.get("direction") == "sent" and c.get("delivered") and c.get("state") == "open" and c.get("state_by") is None and c["bridge_id"] != card_id]
    check("a never-marked delivered card namitest sent", bool(sent), f"{s} {len(sent)}")
    if sent:
        note_card = sent[0]["bridge_id"]
        sql(f"insert into parked_notes (id, writer, partner, text, state, origin, origin_ref) values "
            f"('{bk}','{nid}','{jid}','Probe: bridged note, kept, not brought','later','bridged','{note_card}'),"
            f"('{bj}','{jid}','{nid}','Probe: bridged note, brought','later','bridged','{note_card}')")
        def jan_sees():
            s, j = call("GET", f"/cards/{nid}", token=jt)
            return s, [c for c in j.get("cards") or [] if c["bridge_id"] == note_card], [c for c in j.get("closed") or [] if c["bridge_id"] == note_card]
        def card_rows():
            return sql(f"select count(*)::int as n from bridge_cards where bridge_id = '{note_card}'")[1]
        before = (jan_sees(), card_rows())
        s, j = call("PATCH", f"/checkin/notes/{bk}", {"state": "talked"}, nt)
        check("v1.68: namitest marks a kept note NOT brought talked (own list only)", s == 200 and (j.get("note") or {}).get("state") == "talked" and "card" not in j, f"{s}")
        after = (jan_sees(), card_rows())
        op = after[0][1]
        check("v1.68 guard: jantest's rows unchanged (card still open, no mark, not on closed[], no card row)",
              after == before and after[0][0] == 200 and op and op[0]["state"] == "open" and op[0].get("state_by") is None and not after[0][2]
              and isinstance(after[1], list) and after[1] and int(after[1][0]["n"]) == 0, f"{after[0][0]} open={len(op)} closed={len(after[0][2])} rows={after[1]}")
        s, j = call("PUT", f"/checkin/session/{sid}/items/{bj}", {"bring": True}, jt)
        check("jantest brings a note on the same card", s == 200 and bj in [n.get("note_id") for n in j["session"]["mine"]["brought"]], f"{s}")
        s, j = call("PATCH", f"/checkin/notes/{bj}", {"state": "talked"}, jt)
        check("brought note marked talked (reply is the note)", s == 200 and (j.get("note") or {}).get("state") == "talked" and "card" not in j, f"{s}")
        s, j = call("GET", f"/cards/{jid}", token=nt)
        row = [c for c in j.get("closed") or [] if c["bridge_id"] == note_card]
        check("v1.65 brought: namitest reads that card talked by them, At the check-in", s == 200 and row and row[0]["state"] == "talked" and row[0]["state_by"] == "them" and row[0]["closed_in_check_in"] is True, f"{s}")
    s, j = call("POST", f"/checkin/session/{sid}/close", {}, nt); check("namitest closes", s == 200 and j.get("closed") is True, f"{s}")
    check("a never-marked delivered card to close", card_id is not None)
    if card_id:
        s, j = call("PATCH", f"/cards/{card_id}", {"state": "resolved"}, nt)
        check("closed after the session: closed_in_check_in false", s == 200 and j["card"]["closed_in_check_in"] is False, f"{s}")
    _, out = sql(f"select count(*) as n from checkin_session_parts where session = '{sid}'")
    check("the marks (said, done_bringing) are gone with the session", isinstance(out, list) and out and int(out[0]["n"]) == 0, str(out)[:60])
finally:
    for cid in (card_id, note_card):
        if cid: sql(f"delete from bridge_cards where bridge_id = '{cid}'")
    sql(f"delete from parked_notes where id in ('{nk}','{jk}','{bk}','{bj}')")
    sql(f"delete from checkin_sessions where person_a in ('{nid}','{jid}') and person_b in ('{nid}','{jid}')")
    sql(f"delete from check_ins where id = '{ciid}'")
bad = [n for n, ok, _ in results if not ok]
print(f"{len(results) - len(bad)}/{len(results)} passed")
sys.exit(1 if bad else 0)
