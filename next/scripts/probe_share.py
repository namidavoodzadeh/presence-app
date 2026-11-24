#!/usr/bin/env python3
"""Live probe of the v1.52 share routes + v1.51 quote as namitest/jantest (flagged test accounts). Never prints a secret.

    python3 next/scripts/probe_share.py            # staging
    python3 next/scripts/probe_share.py --hosted   # production (step seed_test_contact loader), fictional belief, deleted after
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
from supabase_env import load_for_step, load_preview_device_secret  # noqa: E402

env = load_for_step("seed_test_contact")
BASE = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
secret_file = Path.home() / "Library/Application Support/PresenceHome/secrets/preview-device.env"
secret = None
if not HOSTED:
    secret = load_preview_device_secret()
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
code, out = run_sql(env, f"insert into beliefs (id, owner, label, statement, type, kind, level, area, status, rating, confirmed_at, rated_at) values ('{bid}', '{nid}', 'probe label', 'Part of you wants a little time to think things over', 'a rule I live by', 'rule', 'L2', 'work', 'confirmed', 'very', now(), now())")
check("seed fictional confirmed belief for namitest", code in (200, 201), f"sql {code} {'' if code in (200,201) else str(out)[:160]}")
try:
    s, j = call("GET", f"/links/{jid}/share", token=nt); check("GET share lists offerable item", s == 200 and bid in json.dumps(j), str(s))
    s, j = call("PUT", f"/links/{jid}/share/items/{bid}", {"shared": True, "wording": "I like a little time to think"}, nt); check("PUT share", s == 200, str(s))
    s, j = call("GET", f"/links/{jid}/share/preview", token=nt); check("preview shows 1 item", s == 200 and json.dumps(j).count("I like a little time") >= 1, str(s))
    s, j = call("GET", f"/people/{nid}/map", token=jt); check("jantest reads shared item, no receipts", s == 200 and "I like a little time" in json.dumps(j) and "probe label" not in json.dumps(j) and not j.get("receipts"), str(s))
    s, j = call("POST", "/bridge/run", {"person_id": nid, "text": "You never make up your mind and it drives me mad."}, jt)
    hl = json.dumps(j)
    check("bridge/run as jantest->namitest answers", s == 200, f"{s} outcome={j.get('outcome')}")
    q = [e for h in (j.get("highlights") or []) for e in h.get("from_them", []) if e.get("quote")]
    check("quote, if present, is the approved wording with label", all(e["quote"] == "I like a little time to think" and e["quote_label"] == "From what Nami shared:" for e in q) and len(q) <= 1, f"quoted={len(q)}")
    check("private label/statement never in the reply", "probe label" not in hl and "Part of you wants" not in hl)
    s, j = call("PUT", f"/links/{jid}/share/items/{bid}", {"shared": False}, nt); check("revoke", s == 200, str(s))
    s, j = call("GET", f"/people/{nid}/map", token=jt); check("after revoke jantest sees no item", "I like a little time" not in json.dumps(j), str(s))
    s, j = call("POST", "/bridge/run", {"person_id": nid, "text": "You never make up your mind and it drives me mad."}, jt)
    check("after revoke no quote", all(not e.get("quote") for h in (j.get("highlights") or []) for e in h.get("from_them", [])) and "I like a little time" not in json.dumps(j), str(s))
finally:
    code, _ = run_sql(env, f"delete from share_items where belief_id = '{bid}'; delete from beliefs where id = '{bid}'")
    print("cleanup sql", code)
print(f"{sum(r[1] for r in results)}/{len(results)} passed")
sys.exit(0 if all(r[1] for r in results) else 1)
