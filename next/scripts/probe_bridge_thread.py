#!/usr/bin/env python3
"""QA-B251 repro: in a thread with one message, send a second; read GET /threads and GET /threads/:person as sender and receiver,
before and after a reopen (a second read). Fictional text, flagged test accounts, cleaned up after. Never prints a secret.

    python3 next/scripts/probe_bridge_thread.py            # staging
    python3 next/scripts/probe_bridge_thread.py --hosted   # production
"""
from __future__ import annotations
import json, os, re, sys, urllib.request, urllib.error
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
HOSTED = "--hosted" in sys.argv
if not HOSTED:
    os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
from supabase_env import load_for_step  # noqa: E402

env = load_for_step("seed_test_contact")
BASE = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
home = Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome"))
secret = None
src = (home / "secrets/preview-device.env") if HOSTED else (home / "secrets/staging.env")
if src.exists():
    m = re.search(r"^(?:export\s+)?PRESENCE_PREVIEW_DEVICE_SECRET=[\"']?([^\"'\s]+)", src.read_text(), re.M)
    secret = m.group(1) if m else None

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

def login(p):
    s, j = call("POST", "/preview/login", {"persona": p})
    return str(j.get("access_token", "")), str(((j.get("me") or {}).get("person") or {}).get("id", ""))

nt, nid = login("namitest"); jt, jid = login("jantest")
if not (nt and jt): print("login failed"); sys.exit(1)
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))
    if not ok: fails.append(name)

def kinds(items): return [(i.get("kind"), (i.get("status") or (i.get("bridge") or {}).get("status") or "")) for i in items]
def snapshot(label, who, tok, other):
    s, j = call("GET", f"/threads/{other}", token=tok)
    items = j.get("items") or []
    s2, t = call("GET", "/threads", token=tok)
    row = next((x for x in (t.get("threads") or []) + (t.get("archived") or []) if (x.get("person") or {}).get("id") == other), None)
    print(f"  {label} {who}: thread {s} items={len(items)} {kinds(items)}; /threads {s2} last={(row or {}).get('last', {}).get('kind')} badge={(row or {}).get('badge')} archived={row in (t.get('archived') or [])}")
    return items, row

ids = []
def send(text):
    s, j = call("POST", "/bridges", {"person_id": jid, "used": "mine", "original": text, "deliver_at": "now"}, nt)
    b = j.get("bridge") or {}
    if b.get("id"): ids.append(b["id"])
    return s, b

try:
    base_s = len(call("GET", f"/threads/{jid}", token=nt)[1].get("items") or [])
    base_r = len(call("GET", f"/threads/{nid}", token=jt)[1].get("items") or [])
    print(f"  baseline items: sender {base_s}, receiver {base_r}")
    s, b1 = send("Probe one: I made soup tonight, fictional.")
    check("send 1", s == 200 and b1.get("id"), str(s))
    snapshot("after 1", "sender", nt, jid)
    s, b2 = send("Probe two: the second message, fictional.")
    check("send 2", s == 200 and b2.get("id"), str(s))
    for rnd in ("after 2", "reopen"):
        items, row = snapshot(rnd, "sender", nt, jid)
        texts = " ".join(str(i) for i in items)
        check(f"sender thread keeps both ({rnd})", len(items) == base_s + 2, f"{len(items)} items vs baseline {base_s}")
        check(f"sender /threads row present, not archived ({rnd})", row is not None and row.get("last", {}).get("kind") not in (None, "none"))
        items, row = snapshot(rnd, "receiver", jt, nid)
        texts = " ".join(str(i) for i in items)
        check(f"receiver thread has both ({rnd})", len(items) == base_r + 2, f"{len(items)} items vs baseline {base_r}")
finally:
    for i in ids:
        s, _ = call("POST", f"/bridges/{i}/withdraw", token=nt)
        print("cleanup withdraw", s)
print("RESULT", "FAIL " + ", ".join(fails) if fails else "PASS")
sys.exit(1 if fails else 0)
