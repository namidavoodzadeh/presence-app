#!/usr/bin/env python3
"""QA-B298: time POST /bridge/insight on STAGING (plain and with_wording), cold then warm, namitest -> jantest.
Fictional draft text only; nothing is stored (live drafts are never stored). Prints status and ms, never a token.

    python3 next/scripts/probe_insight_latency.py [N]
"""
from __future__ import annotations
import json, os, re, statistics, sys, time, urllib.request, urllib.error
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
from supabase_env import load_for_step  # noqa: E402

env = load_for_step("seed_test_contact")
BASE = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
home = Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome"))
m = re.search(r"^PRESENCE_PREVIEW_DEVICE_SECRET=(\S+)", (home / "secrets/staging.env").read_text(), re.M)
secret = m.group(1) if m else None
N = int(sys.argv[1]) if len(sys.argv) > 1 else 3
TEXT = "You never listen when I talk about my day, and you always check your phone. I need you to stop doing that tonight."


def call(method, path, body=None, token=None):
    h = {"content-type": "application/json", "apikey": env.get("SUPABASE_ANON_KEY", "")}
    if token: h["authorization"] = "Bearer " + token
    if secret and path == "/preview/login": h["x-presence-preview-secret"] = secret
    req = urllib.request.Request(BASE + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=90) as r: s, j = r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        s = e.code
        try: j = json.loads(e.read() or b"{}")
        except Exception: j = {}
    return s, j, (time.perf_counter() - t) * 1000


s, j, _ = call("POST", "/preview/login", {"persona": "namitest"})
tok = str(j.get("access_token", ""))
s2, j2, _ = call("POST", "/preview/login", {"persona": "jantest"})
jan = {"id": str(((j2.get("me") or {}).get("person") or {}).get("id", ""))}
if not tok or not jan["id"]:
    print("setup failed: login", s, s2); sys.exit(1)
for label, extra in (("plain", {}), ("with_wording", {"with_wording": True})):
    ms = []
    for i in range(N):
        s, r, t = call("POST", "/bridge/insight", {"person_id": jan["id"], "text": TEXT, "seq": i, **extra}, tok)
        ms.append(t); print(f"{label} #{i} status={s} state={r.get('state')} {t:.0f} ms")
    print(f"{label}: first {ms[0]:.0f} ms, warm median {statistics.median(ms[1:] or ms):.0f} ms, max {max(ms):.0f} ms")
