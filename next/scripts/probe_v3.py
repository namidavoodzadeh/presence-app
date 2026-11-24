#!/usr/bin/env python3
"""Live probe of GET /home (v1.58) and GET /kennings (v1.59) as namitest/jantest (flagged test accounts). Never prints a secret.

    python3 next/scripts/probe_v3.py            # staging
    python3 next/scripts/probe_v3.py --hosted   # production (step seed_test_contact loader), fictional belief, deleted after
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
bid = str(uuid.uuid4())
code, out = run_sql(env, f"insert into beliefs (id, owner, label, statement, type, kind, level, area, status, rating, confirmed_at, rated_at) values ('{bid}', '{nid}', 'probe label', 'Part of you wants a little time to think.', 'a rule I live by', 'rule', 'L2', 'work', 'confirmed', 'very', now(), now())")
check("seed fictional confirmed belief for namitest", code in (200, 201), f"sql {code} {'' if code in (200,201) else str(out)[:160]}")
try:
    s, j = call("GET", "/home", token=nt)
    ps = j.get("people") or []
    check("GET /home 200, order least_urgent_first, Jan listed", s == 200 and j.get("order") == "least_urgent_first" and any(p["person"]["id"] == jid for p in ps), f"{s} people={len(ps)}")
    check("home rows carry only numbers and kinds", all(set(p) >= {"person", "reasons", "unread", "open_items", "checkin_at", "invite_check_in_id", "draft", "pinned", "muted", "activity_at"} for p in ps))
    s, j = call("PUT", f"/links/{jid}/share/items/{bid}", {"shared": True, "wording": "I like a little time to think"}, nt); check("share to Jan", s == 200, str(s))
    s, j = call("GET", "/kennings", token=nt)
    items = [i for g in j.get("groups", []) for i in g["items"]]
    mine = [i for i in items if i["belief_id"] == bid]
    check("GET /kennings lists the belief under work", s == 200 and mine and mine[0]["area"] == "work" and any(g["topic"] == "work" for g in j["groups"]), str(s))
    check("seen_by names Jan", mine and any(p["person_id"] == jid for p in mine[0]["seen_by"]))
    s, j = call("PUT", f"/links/{jid}/share/items/{bid}", {"shared": False}, nt)
    s, j = call("GET", "/kennings", token=nt)
    mine = [i for g in j.get("groups", []) for i in g["items"] if i["belief_id"] == bid]
    check("after revoke seen_by is empty", s == 200 and mine and mine[0]["seen_by"] == [])
    s, j = call("GET", "/kennings", token=jt)
    check("Jan's kennings never include Nami's", s == 200 and bid not in json.dumps(j), str(s))
finally:
    code, _ = run_sql(env, f"delete from share_items where belief_id = '{bid}'; delete from beliefs where id = '{bid}'")
    print("cleanup sql", code)
print(f"{sum(r[1] for r in results)}/{len(results)} passed")
sys.exit(0 if all(r[1] for r in results) else 1)
