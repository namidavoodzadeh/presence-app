#!/usr/bin/env python3
"""Live probe of POST /diagnostics (0037, CPO ruling a/b/d, 0058) on staging (--hosted: production, test account only).
A crash report with a composed exception message and a screen trail is sent as namitest; the stored row must keep the exception name and
class but not the message, arguments or trail; a resend returns the same ref (one row); purge_client_diagnostics(90) leaves a fresh row.
The probe row is deleted at the end. Never prints a secret or a token."""
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


import random
owner = login("namitest")
if not owner: sys.exit(1)
ref = "".join(random.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(4))
report = {"crashDiagnostics": [{"diagnosticMetaData": {"appVersion": "probe", "signal": "6",
          "objectiveCexceptionReason": {"exceptionName": "NSProbeException", "className": "NSProbe", "composedMessage": "PROBE-WORDS-SECRET", "arguments": ["PROBE-ARG-SECRET"]}},
          "callStackTree": {"callStacks": [{"callStackRootFrames": [{"binaryName": "Presence", "address": 1}]}]}}],
          "timeStampBegin": "2026-11-13", "screenTrail": ["PROBE-TRAIL-SECRET"]}
body = {"ref": ref, "kind": "crash", "release": "probe (1)", "report": report}
try:
    s, j = call("POST", "/diagnostics", body, owner)
    check("POST /diagnostics 200 with a ref", s == 200 and j.get("ok") and j.get("ref"), f"{s}")
    s2, j2 = call("POST", "/diagnostics", body, owner)
    check("resend returns the same ref", s2 == 200 and j2.get("ref") == j.get("ref"), f"{s2}")
    st, rows = run_sql(env, f"select report::text r, release, source, code from public.errors where client_ref = '{ref}'")
    check("exactly one row stored", st in (200, 201) and rows.count('"code"') == 1, f"{st}")
    check("exception name and class kept", "NSProbeException" in rows and "NSProbe" in rows)
    check("message, arguments and trail dropped", not any(x in rows for x in ("PROBE-WORDS-SECRET", "PROBE-ARG-SECRET", "PROBE-TRAIL-SECRET", "composedMessage", "screenTrail")))
    st, out = run_sql(env, "select public.purge_client_diagnostics(90) as n")
    check("purge function runs", st in (200, 201), f"{st}")
    st, rows = run_sql(env, f"select 1 from public.errors where client_ref = '{ref}'")
    check("fresh row survives the 90-day purge", rows.count("1") >= 1)
finally:
    st, _ = run_sql(env, f"delete from public.errors where client_ref = '{ref}' and source = 'client'")
    print("deleted the probe's row", st)
print(f"{sum(r[1] for r in results)}/{len(results)} passed")
sys.exit(0 if all(r[1] for r in results) else 1)
