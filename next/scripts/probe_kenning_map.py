#!/usr/bin/env python3
"""Live probe of the kenning map (v1.67/v1.72, migrations 0060 + 0062) as namitest/jantest (flagged test accounts).
Never prints a secret. Seeds two fictional confirmed kennings; every row it makes is deleted at the end.

    python3 next/scripts/probe_kenning_map.py            # staging
    python3 next/scripts/probe_kenning_map.py --hosted   # production (step seed_test_contact loader)

Checks: GET /kennings/map 200 with both stations; one station action (Keep off the map) and its undo; a both_true link
and its delete; set lines and restore; jantest's map never holds namitest's kennings.
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
home = Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome"))
secret = None
if not HOSTED:
    m = re.search(r"^PRESENCE_PREVIEW_DEVICE_SECRET=(\S+)", (home / "secrets/staging.env").read_text(), re.M)
    secret = m.group(1) if m else None
elif (home / "secrets/preview-device.env").exists():
    m = re.search(r"^(?:export\s+)?PRESENCE_PREVIEW_DEVICE_SECRET=[\"']?([^\"'\s]+)", (home / "secrets/preview-device.env").read_text(), re.M)
    secret = m.group(1) if m else None
results: list[tuple[str, bool]] = []


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
    results.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def login(p):
    s, j = call("POST", "/preview/login", {"persona": p})
    return str(j.get("access_token", "")), str(((j.get("me") or {}).get("person") or {}).get("id", "")), s


def station_ids(j):
    return {s.get("belief_id") for s in j.get("stations", [])}


nt, nid, s1 = login("namitest"); jt, jid, s2 = login("jantest")
check("login namitest/jantest", nt and jt and nid and jid, f"{s1}/{s2}")
if not (nt and jt): sys.exit(1)
a, b = str(uuid.uuid4()), str(uuid.uuid4())
code, out = run_sql(env, "insert into beliefs (id, owner, label, statement, type, kind, level, area, status, rating, confirmed_at, rated_at) values "
                    f"('{a}', '{nid}', 'probe map a', 'Part of you likes a slow start to the day.', 'a rule I live by', 'rule', 'L0', 'work', 'confirmed', 'very', now(), now()), "
                    f"('{b}', '{nid}', 'probe map b', 'Part of you wants quiet before a busy week.', 'a rule I live by', 'rule', 'L2', 'work', 'confirmed', 'partly', now(), now())")
check("seed two fictional confirmed kennings for namitest", code in (200, 201), f"sql {code} {'' if code in (200, 201) else str(out)[:160]}")
link_id = None
try:
    s, j = call("GET", "/kennings/map", token=nt)
    check("GET /kennings/map 200 with both stations", s == 200 and {a, b} <= station_ids(j) and "layout" in j and isinstance(j.get("ask_comes_from"), list), f"{s} stations={len(j.get('stations', []))}")
    s, j = call("PATCH", f"/kennings/{a}/map", {"hidden": True}, nt)
    check("station action: Keep off the map", s == 200 and j.get("hidden") is True, str(s))
    s, j = call("GET", "/kennings/map", token=nt)
    check("hidden station leaves the map", s == 200 and a not in station_ids(j) and b in station_ids(j), str(s))
    s, j = call("PATCH", f"/kennings/{a}/map", {"hidden": False}, nt)
    s2_, j2 = call("GET", "/kennings/map", token=nt)
    check("undo: station back on the map", s == 200 and s2_ == 200 and a in station_ids(j2), f"{s}/{s2_}")
    s, j = call("PATCH", f"/kennings/{b}/map", {"lines": ["work", "me"]}, nt)
    s2_, j2 = call("GET", "/kennings/map", token=nt)
    st = [x for x in j2.get("stations", []) if x.get("belief_id") == b]
    check("set two lines", s == 200 and st and sorted(st[0].get("lines", [])) == ["me", "work"], f"{s}/{s2_}")
    s, j = call("PUT", "/kennings/links", {"a": a, "b": b, "kind": "both_true"}, nt)
    link_id = (j.get("link") or {}).get("link_id")
    s2_, j2 = call("GET", "/kennings/map", token=nt)
    check("both_true link drawn", s == 200 and link_id and any(l.get("link_id") == link_id for l in j2.get("links", [])), f"{s}/{s2_}")
    s, j = call("DELETE", f"/kennings/links/{link_id}", token=nt)
    s2_, j2 = call("GET", "/kennings/map", token=nt)
    check("undo: link deleted", s == 200 and not any(l.get("link_id") == link_id for l in j2.get("links", [])), f"{s}/{s2_}")
    if not any(l.get("link_id") == link_id for l in j2.get("links", [])): link_id = None
    s, j = call("GET", "/kennings/map", token=jt)
    check("jantest's map never holds namitest's kennings", s == 200 and a not in json.dumps(j) and b not in json.dumps(j), str(s))
finally:
    code, _ = run_sql(env, f"delete from kenning_links where a_belief in ('{a}','{b}') or b_belief in ('{a}','{b}'); "
                           f"delete from kenning_because where a_belief in ('{a}','{b}') or b_belief in ('{a}','{b}'); "
                           f"delete from share_items where belief_id in ('{a}','{b}'); delete from beliefs where id in ('{a}','{b}')")
    print("cleanup sql", code)
print(f"{sum(r[1] for r in results)}/{len(results)} passed")
sys.exit(0 if all(r[1] for r in results) else 1)
