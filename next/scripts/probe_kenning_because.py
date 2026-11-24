#!/usr/bin/env python3
"""Live probe of contract v1.72 (migration 0062): ask_comes_from on GET /kennings/map and comes_from_declined on PATCH, as namitest
(flagged test account). STAGING only. Never prints a secret. Every row it makes is deleted at the end.

    python3 next/scripts/probe_kenning_because.py
"""
from __future__ import annotations
import json, os, re, sys, urllib.request, urllib.error, uuid
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
from supabase_api import run_sql  # noqa: E402
from supabase_env import load_for_step  # noqa: E402

env = load_for_step("seed_test_contact")
BASE = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
_secrets = Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome")) / "secrets"
m = re.search(r"^PRESENCE_PREVIEW_DEVICE_SECRET=(\S+)", (_secrets / "staging.env").read_text(), re.M)
secret = m.group(1) if m else None
results: list[tuple[str, bool]] = []


def call(method, path, body=None, token=None):
    h = {"content-type": "application/json", "accept": "application/json", "apikey": env.get("SUPABASE_ANON_KEY", "")}
    if token: h["authorization"] = "Bearer " + token
    if secret and path == "/preview/login": h["x-presence-preview-secret"] = secret
    req = urllib.request.Request(BASE + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=90) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}


def check(name, ok, detail=""):
    results.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


s, j = call("POST", "/preview/login", {"persona": "namitest"})
tok = str(j.get("access_token", "")); nid = str(((j.get("me") or {}).get("person") or {}).get("id", ""))
check("login namitest", tok and nid, str(s))
if not tok: sys.exit(1)
TAG = uuid.uuid4().hex[:6]
made: list[str] = []
try:
    ids = []
    for w in (f"I go quiet when plans change ({TAG}a).", f"I say it's fine to keep the peace ({TAG}b)."):
        s, j = call("POST", "/beliefs", {"statement": w}, tok)
        bid = (j.get("belief") or {}).get("belief_id")
        if bid: made.append(str(bid)); ids.append(str(bid))
    check("two own kennings created", len(ids) == 2)
    a, b = ids
    s, j = call("GET", "/kennings/map", token=tok)
    check("GET /kennings/map carries ask_comes_from as a list", s == 200 and isinstance(j.get("ask_comes_from"), list), f"{s}")
    check("no pair yet: neither id asked", not any(p.get("a") in ids or p.get("b") in ids for p in j.get("ask_comes_from") or []))
    run_sql(env, f"insert into kenning_because (owner, a_belief, b_belief) values ('{nid}', '{a}', '{b}')")
    s, j = call("GET", "/kennings/map", token=tok)
    check("heard pair shows as one ask {a,b}", s == 200 and [p for p in j.get("ask_comes_from") or [] if p.get("a") == a and p.get("b") == b].__len__() == 1, f"{s}")
    check("ask carries ids only", all(set(p) == {"a", "b"} for p in j.get("ask_comes_from") or []))
    s, j = call("PATCH", f"/kennings/{a}/map", {"comes_from_declined": b}, tok)
    check("PATCH comes_from_declined round-trips", s == 200 and j.get("comes_from_declined") == b, f"{s}")
    s, j = call("GET", "/kennings/map", token=tok)
    check("declined pair never asked again", s == 200 and not [p for p in j.get("ask_comes_from") or [] if p.get("a") == a and p.get("b") == b], f"{s}")
    s, j = call("PATCH", f"/kennings/{a}/map", {"comes_from_declined": a}, tok)
    check("declining a belief against itself is 400", s == 400, f"{s}")
    s, j = call("PATCH", f"/kennings/{b}/map", {"comes_from_declined": a}, tok)
    check("a pair never heard is 404", s == 404, f"{s}")
finally:
    for bid in made:
        run_sql(env, f"delete from share_items where belief_id = '{bid}'"); run_sql(env, f"delete from beliefs where id = '{bid}'")
    print("cleaned", len(made), "beliefs")
bad = [n for n, ok in results if not ok]
print(f"{len(results) - len(bad)}/{len(results)} passed")
sys.exit(1 if bad else 0)
