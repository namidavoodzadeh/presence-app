#!/usr/bin/env python3
"""Live probe of the v1.53 shared check-in session as namitest/jantest (flagged test accounts). Never prints a secret.

    python3 next/scripts/probe_checkin_session.py            # staging
    python3 next/scripts/probe_checkin_session.py --hosted   # production (step seed_test_contact loader), fictional belief, deleted after
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
    return run_sql(env, q)
# fictional rows, all removed at the end: an accepted check-in jan -> nami, nami's kept note and a parked one, jan's kept note
nk, np_, jk = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
ciid = str(uuid.uuid4())
sql(f"delete from checkin_sessions where person_a in ('{nid}','{jid}') and person_b in ('{nid}','{jid}')")
code, _ = sql(f"insert into check_ins (id, owner, person, day, time, tz, status) values ('{ciid}', '{jid}', '{nid}', 'sunday', '10:00', 'UTC', 'active') on conflict (owner, person) do update set status = 'active'")
check("seed accepted check-in", code in (200, 201), str(code))
sql(f"insert into parked_notes (id, writer, partner, text, state) values ('{nk}','{nid}','{jid}','Probe: I like planning ahead','later'),('{np_}','{nid}','{jid}','Probe: parked not kept','parked'),('{jk}','{jid}','{nid}','Probe: I need some quiet','later')")
try:
    s, j = call("POST", f"/checkin/{jid}/session", {}, nt); sid = (j.get("session") or {}).get("id", "")
    check("namitest opens session", s == 200 and sid and j["session"]["phase"] == "appreciations", str(s))
    s, j = call("POST", f"/checkin/{nid}/session", {}, jt); check("jantest gets the same session", s == 200 and j["session"]["id"] == sid, str(s))
    s, j = call("PUT", f"/checkin/session/{sid}/items/{nk}", {"bring": True}, nt); check("bring before appreciations refused", s == 409 and "appreciation_first" in json.dumps(j), str(s))
    s, j = call("PUT", f"/checkin/session/{sid}/appreciation", {"text": "Thank you for the walk on Sunday"}, nt); check("namitest appreciation", s == 200 and j.get("state") == "ok", f"{s} {j.get('state')}")
    s, j = call("GET", f"/checkin/{nid}/session", token=jt); check("jantest cannot read it yet", s == 200 and j["session"]["theirs"]["appreciation"] is None, str(s))
    s, j = call("PUT", f"/checkin/session/{sid}/appreciation", {"text": "I liked how you listened"}, jt); check("jantest appreciation, phase items", s == 200 and j["session"]["phase"] == "items" and j["session"]["theirs"]["appreciation"], f"{s}")
    s, j = call("PUT", f"/checkin/session/{sid}/items/{np_}", {"bring": True}, nt); check("parked (not kept) note refused", s == 404, str(s))
    s, j = call("PUT", f"/checkin/session/{sid}/items/{nk}", {"bring": True}, nt); check("kept note brought", s == 200 and len(j["session"]["mine"]["brought"]) == 1, str(s))
    s, j = call("GET", f"/checkin/{nid}/session", token=jt); check("jantest sees the brought words only (and v1.67 state)", s == 200 and j["session"]["theirs"]["brought"] == [{"text": "Probe: I like planning ahead", "state": "parked"}] and "parked not kept" not in json.dumps(j), str(s))
    s, j = call("POST", f"/checkin/session/{sid}/close", {}, jt); check("jantest closes", s == 200 and j.get("closed") is True, str(s))
    _, out = sql(f"select (select count(*) from checkin_sessions) as s, (select count(*) from checkin_session_parts) as p, (select count(*) from checkin_session_items) as i")
    check("every session row gone", all(int(v) == 0 for v in (out[0] if isinstance(out, list) and out else {}).values()), str(out)[:120])
finally:
    sql(f"delete from parked_notes where id in ('{nk}','{np_}','{jk}')")
    sql(f"delete from checkin_sessions where person_a in ('{nid}','{jid}') and person_b in ('{nid}','{jid}')")
    if not HOSTED: pass
bad = [n for n, ok, _ in results if not ok]
print(f"{len(results) - len(bad)}/{len(results)} passed")
sys.exit(1 if bad else 0)
