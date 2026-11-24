#!/usr/bin/env python3
"""Live probe of single-use, 7-day invite codes (v1.62, migration 0054) on staging (or hosted with --hosted) as namitest and jantest (flagged test
accounts). Never prints a secret or a token.

    python3 next/scripts/probe_invite_single_use.py     # staging
    python3 next/scripts/probe_invite_single_use.py --hosted   # production (seed_test_contact loader), test accounts only

namitest makes a code (expires_at 7 days ahead); jantest peeks it (200, unused). The code is then marked used the way a
joiner who later deleted their account leaves it (accepted_at set, accepted_by null), by SQL on the probe's own invite row only; jantest's
peek and accept now answer 404 not_found and no link is made. The probe's invite row is deleted at the end.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
HOSTED = "--hosted" in sys.argv  # Nami's yes for v1.60-v1.62 on hosted, 12 Nov 16:44Z (COO 17:20Z)
if not HOSTED:
    os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
from supabase_env import load_for_step  # noqa: E402
from supabase_api import run_sql  # noqa: E402

env = load_for_step("seed_test_contact")
BASE = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
_secrets = Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome")) / "secrets"
if HOSTED:  # production: the preview-device secret file, as probe_v3 --hosted reads it
    _f = _secrets / "preview-device.env"
    m = re.search(r"^(?:export\s+)?PRESENCE_PREVIEW_DEVICE_SECRET=[\"']?([^\"'\s]+)", _f.read_text(), re.M) if _f.exists() else None
else:
    m = re.search(r"^PRESENCE_PREVIEW_DEVICE_SECRET=(\S+)", (_secrets / "staging.env").read_text(), re.M)
secret = m.group(1) if m else None
print("target", "hosted" if HOSTED else "staging")
results: list[tuple[str, bool, str]] = []


def call(method, path, body=None, token=None):
    h = {"content-type": "application/json", "accept": "application/json", "apikey": env.get("SUPABASE_ANON_KEY", "")}
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


def login(persona):
    s, j = call("POST", "/preview/login", {"persona": persona})
    tok = str(j.get("access_token", ""))
    check(f"login {persona}", tok, str(s))
    return tok


owner, other = login("namitest"), login("jantest")
if not (owner and other): sys.exit(1)
s, j = call("GET", "/people", token=other)
links_before = len(j.get("people") or [])
code = ""
try:
    s, j = call("POST", "/invites", {}, owner)
    code = str(j.get("code") or "")
    days = (datetime.fromisoformat(str(j.get("expires_at")).replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds() / 86400 if j.get("expires_at") else -1
    check("POST /invites expires in 7 days", s == 200 and code and 6.9 < days <= 7.01, f"{s} {days:.2f} days")
    s, j = call("GET", f"/invites/{code}", token=other)
    check("unused code: peek 200 with the inviter", s == 200 and (j.get("inviter") or {}).get("name"), f"{s}")
    st, body = run_sql(env, f"update public.invites set accepted_at = now(), accepted_by = null where code = '{code}' returning id")
    check("mark the code used (SQL, probe row only)", st in (200, 201) and '"id"' in body, f"{st}")
    s, j = call("GET", f"/invites/{code}", token=other)
    check("used code: peek 404 not_found", s == 404 and json.dumps(j).find("not_found") >= 0, f"{s}")
    s, j = call("POST", f"/invites/{code}/accept", {}, other)
    check("used code: accept 404 not_found", s == 404 and json.dumps(j).find("not_found") >= 0, f"{s}")
    s, j = call("GET", "/people", token=other)
    check("no new link for jantest", s == 200 and len(j.get("people") or []) == links_before, f"{s}")
finally:
    if code:
        st, _ = run_sql(env, f"delete from public.invites where code = '{code}' and accepted_by is null")
        print("deleted the probe's invite", st)
print(f"{sum(r[1] for r in results)}/{len(results)} passed")
sys.exit(0 if all(r[1] for r in results) else 1)
