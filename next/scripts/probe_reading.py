#!/usr/bin/env python3
"""Live probe of the v1.52 share routes + v1.51 quote as namitest/jantest (flagged test accounts). Never prints a secret.

    python3 next/scripts/probe_reading.py            # staging
    python3 next/scripts/probe_reading.py --hosted   # production (step seed_test_contact loader), fictional belief, deleted after
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
bid = str(uuid.uuid4()); mid = str(uuid.uuid4())
run_sql(env, f"insert into beliefs (id, owner, label, statement, type, kind, level, area, status, rating, confirmed_at, rated_at) values ('{bid}', '{nid}', 'probe label', 'Part of you needs quiet after a long day', 'a rule I live by', 'rule', 'L2', 'work', 'confirmed', 'very', now(), now())")
def msg(text):
    run_sql(env, f"delete from bridges where id = '{mid}'")
    code, out = run_sql(env, f"insert into bridges (id, sender, receiver, original, final, used, deliver_at, status, opened_at) values ('{mid}', '{nid}', '{jid}', $q${text}$q$, $q${text}$q$, 'mine', now() - interval '1 hour', 'scheduled', now())")
    return code in (200, 201)
try:
    s, j = call("GET", f"/links/{jid}/reading", token=nt); check("switch defaults off", s == 200 and j.get("help_read") is False, str(s))
    check("seed opened message", msg("I am skipping Friday, it has been a long week."))
    s, j = call("POST", f"/bridges/{mid}/reading", {}, jt); check("switch off: plain not available", s == 200 and j == {"available": False}, f"{s} {j}")
    s, j = call("POST", f"/bridges/{mid}/reading", {}, nt); check("writer cannot read their own: 404", s == 404, str(s))
    s, j = call("PUT", f"/links/{jid}/reading", {"help_read": True}, nt); check("PUT on", s == 200 and j.get("help_read") is True and j.get("confirmed_at"), str(s))
    s, j = call("POST", f"/bridges/{mid}/reading", {}, jt); check("on, nothing granted: not available", s == 200 and j == {"available": False}, f"{s} {j}")
    s, j = call("PUT", f"/links/{jid}/share/items/{bid}", {"shared": True, "wording": "I need quiet after a long day"}, nt); check("grant one item", s == 200, str(s))
    s, j = call("POST", f"/bridges/{mid}/reading", {}, jt)
    ms = j.get("meanings") or []
    check("reading is 2-3 meanings or plain not available (one granted item, live model)", s == 200 and (j.get("available") is False or (2 <= len(ms) <= 3 and all(m.get("item") == "I need quiet after a long day" for m in ms))), f"{s} available={j.get('available')} n={len(ms)}")
    check("reply carries no private statement or label", "Part of you needs" not in json.dumps(j) and "probe label" not in json.dumps(j))
    check("threat message flagged with resources", msg("I will kill you if you come on Friday") and (lambda r: r[0] == 200 and r[1].get("flagged") is True and r[1].get("resources"))(call("POST", f"/bridges/{mid}/reading", {}, jt)))
    s, j = call("PUT", f"/links/{jid}/reading", {"help_read": False}, nt); check("PUT off", s == 200 and j.get("help_read") is False, str(s))
    msg("I am skipping Friday, it has been a long week.")
    s, j = call("POST", f"/bridges/{mid}/reading", {}, jt); check("after off: plain not available", s == 200 and j == {"available": False}, f"{s} {j}")
finally:
    code, _ = run_sql(env, f"delete from bridges where id = '{mid}'; delete from share_items where belief_id = '{bid}'; delete from beliefs where id = '{bid}'; update link_prefs set help_read = false, help_read_at = null where owner = '{nid}' and other = '{jid}'")
    print("cleanup sql", code)
print(f"{sum(r[1] for r in results)}/{len(results)} passed")
sys.exit(0 if all(r[1] for r in results) else 1)
