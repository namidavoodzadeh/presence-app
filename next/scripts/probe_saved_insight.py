#!/usr/bin/env python3
"""QA-B240 probe on STAGING (migration 0059): a saved draft insight is returned without a model call; edit/refresh recompute.
Fictional draft text only; nothing is stored (live drafts are never stored). Prints status and ms, never a token.

    python3 next/scripts/probe_saved_insight.py [N]
    python3 next/scripts/probe_saved_insight.py --hosted   # production (step seed_test_contact loader), namitest/jantest, fictional text
"""
from __future__ import annotations
import json, os, re, statistics, sys, time, urllib.request, urllib.error
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
HOSTED = "--hosted" in sys.argv
sys.argv = [a for a in sys.argv if a != "--hosted"]
if not HOSTED:
    os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
from supabase_env import load_for_step  # noqa: E402

env = load_for_step("seed_test_contact")
BASE = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
home = Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome"))
m = re.search(r"^PRESENCE_PREVIEW_DEVICE_SECRET=(\S+)", (home / "secrets/staging.env").read_text(), re.M)
secret = m.group(1) if m else None
if HOSTED:
    secret = None
    pf = home / "secrets/preview-device.env"
    if pf.exists():
        m = re.search(r"^(?:export\s+)?PRESENCE_PREVIEW_DEVICE_SECRET=[\"']?([^\"'\s]+)", pf.read_text(), re.M)
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
fails = []
def check(name, ok, note=""):
    print(("ok   " if ok else "FAIL ") + name, note)
    if not ok: fails.append(name)

s, _, _ = call("PUT", f"/drafts/{jan['id']}", {"text": TEXT}, tok); check("PUT draft", s == 200, s)
s, a, ta = call("POST", "/bridge/insight", {"person_id": jan["id"], "text": TEXT, "seq": 1}, tok)
if s == 429:  # the persona's daily AI allowance is spent: not a product failure, nothing to judge
    call("DELETE", f"/drafts/{jan['id']}", None, tok)
    print(f"SKIPPED: 429 {a.get('error')} scope={a.get('scope')} opens_at={a.get('opens_at')}; rerun after it opens"); sys.exit(2)
check("first call computes", s == 200 and a.get("state") == "insight" and not a.get("saved"), f"{ta:.0f} ms")
time.sleep(3)  # the save runs after the reply
s, b, tb = call("POST", "/bridge/insight", {"person_id": jan["id"], "text": TEXT, "seq": 2}, tok)
check("reopen returns saved", s == 200 and b.get("saved") is True and b.get("seq") == 2, f"{tb:.0f} ms")
check("saved spans equal computed", b.get("spans") == a.get("spans") and b.get("points") == a.get("points"))
s, c, tc = call("POST", "/bridge/insight", {"person_id": jan["id"], "text": TEXT, "seq": 3, "refresh": True}, tok)
check("refresh recomputes", s == 200 and not c.get("saved"), f"{tc:.0f} ms")
time.sleep(3)
s, _, _ = call("PUT", f"/drafts/{jan['id']}", {"text": TEXT}, tok)
s, d, _ = call("POST", "/bridge/insight", {"person_id": jan["id"], "text": TEXT, "seq": 4}, tok)
check("unchanged PUT keeps it", d.get("saved") is True)
T2 = TEXT + " Thanks."
call("PUT", f"/drafts/{jan['id']}", {"text": T2}, tok)
s, e, _ = call("POST", "/bridge/insight", {"person_id": jan["id"], "text": T2, "seq": 5}, tok)
check("edited draft recomputes", s == 200 and not e.get("saved"))
s, f, _ = call("POST", "/bridge/insight", {"person_id": jan["id"], "text": TEXT, "seq": 6, "with_wording": True}, tok)
check("other mode never served from the plain save", s == 200 and not f.get("saved"))
call("DELETE", f"/drafts/{jan['id']}", None, tok)
s, g, _ = call("POST", "/bridge/insight", {"person_id": jan["id"], "text": TEXT, "seq": 7}, tok)
check("no draft row, nothing saved or served", s == 200 and not g.get("saved"))
time.sleep(2)
s, h, _ = call("GET", f"/drafts/{jan['id']}", None, tok)
check("no draft was created by the insight call", (h.get("draft") is None), h)
print("FAILED" if fails else "ALL OK"); sys.exit(1 if fails else 0)
