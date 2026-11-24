#!/usr/bin/env python3
"""Live probe of the Mirror question (v1.60, migration 0053) on staging (or hosted with --hosted) as namitest (flagged test account). Never prints a secret.

    python3 next/scripts/probe_mirror_question.py     # staging
    python3 next/scripts/probe_mirror_question.py --hosted   # production (seed_test_contact loader), test accounts only

Sets a question, reads it on GET /mirror and GET /m/:slug, checks the 140-character limit and the law 8 floor, rotates (the
question clears, the old slug stops), then puts namitest's link back as it was (on, who, paused; the slug stays the new one).
"""
from __future__ import annotations
import json, os, re, sys, urllib.request, urllib.error
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
HOSTED = "--hosted" in sys.argv  # Nami's yes for v1.60-v1.62 on hosted, 12 Nov 16:44Z (COO 17:20Z)
if not HOSTED:
    os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
from supabase_env import load_for_step  # noqa: E402

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


s, j = call("POST", "/preview/login", {"persona": "namitest"})
tok = str(j.get("access_token", ""))
check("login namitest", tok, str(s))
if not tok: sys.exit(1)
s, j = call("GET", "/mirror", token=tok)
before = j.get("mirror") or {}
check("GET /mirror 200 carries question", s == 200 and "question" in before, f"{s}")
Q = "When do I shut a conversation down?"
try:
    s, j = call("PATCH", "/mirror", {"on": True, "question": Q}, tok)
    mir = j.get("mirror") or {}
    slug = str(mir.get("slug") or "")
    check("PATCH question stored and echoed", s == 200 and mir.get("question") == Q and slug, f"{s}")
    s, j = call("GET", f"/m/{slug}")
    check("GET /m/:slug shows the question while open", s == 200 and j.get("open") is True and j.get("question") == Q, f"{s}")
    s, j = call("PATCH", "/mirror", {"question": "x" * 141}, tok)
    check("141 characters is 400 invalid field question", s == 400 and json.dumps(j).find("question") >= 0, f"{s}")
    s, j = call("PATCH", "/mirror", {"question": "I want to kill myself, would anyone notice?"}, tok)
    check("risk question: state safety, resources, earlier question kept", s == 200 and j.get("state") == "safety" and j.get("resources") and (j.get("mirror") or {}).get("question") == Q, f"{s}")
    s, j = call("PATCH", "/mirror", {"paused": True}, tok)
    s, j = call("GET", f"/m/{slug}")
    check("paused page: no question", s == 200 and j.get("open") is False and j.get("question") is None, f"{s}")
    call("PATCH", "/mirror", {"paused": False}, tok)
    s, j = call("POST", "/mirror/rotate", {}, tok)
    check("rotate clears the question", s == 200 and (j.get("mirror") or {}).get("question") is None, f"{s}")
    s, j = call("GET", f"/m/{slug}")
    check("old slug answers not_found", s == 200 and j.get("reason") == "not_found", f"{s}")
finally:
    restore = {"on": bool(before.get("on")), "who": before.get("who") or "anyone", "question": before.get("question")}
    s, _ = call("PATCH", "/mirror", restore, tok)
    if before.get("paused"): call("PATCH", "/mirror", {"paused": True}, tok)
    print("restored namitest's link", s)
print(f"{sum(r[1] for r in results)}/{len(results)} passed")
sys.exit(0 if all(r[1] for r in results) else 1)
