#!/usr/bin/env python3
"""Live probe of v1.69 (CPO 12 Nov 22:40Z (1)): the send reply (POST /bridges, PATCH /bridges/:id) carries
`bridge.deliver_at`, `bridge.delivered` and `held_by_window`. The engine has no receiver delivery window, so a 'now' send is
delivered in the same reply and `held_by_window` is false; a later time is stored exactly as the sender chose it.
Never prints a secret or a token.

    python3 next/scripts/probe_send_window.py            # staging
    python3 next/scripts/probe_send_window.py --hosted   # production, only after Nami's yes

namitest -> jantest (flagged test accounts). The 'now' send runs only when jantest has no enabled device token on that
server (no push reaches a phone); otherwise it is skipped and said so. Every probe bridge, its push rows and any draft it
cleared are removed at the end (fictional words starting 'Probe:').
"""
from __future__ import annotations
import json, os, re, sys, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
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
secret = None
if not HOSTED:
    m = re.search(r"^PRESENCE_PREVIEW_DEVICE_SECRET=(\S+)", (Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome")) / "secrets/staging.env").read_text(), re.M)
    secret = m.group(1) if m else None
else:
    f = Path.home() / "Library/Application Support/PresenceHome/secrets/preview-device.env"
    if f.exists():
        m = re.search(r"^(?:export\s+)?PRESENCE_PREVIEW_DEVICE_SECRET=[\"']?([^\"'\s]+)", f.read_text(), re.M)
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


def sql(q):
    st, body = run_sql(env, q)
    try: return st, json.loads(body) if isinstance(body, str) else body
    except ValueError: return st, body


def login(p):
    s, j = call("POST", "/preview/login", {"persona": p})
    return str(j.get("access_token", "")), str(((j.get("me") or {}).get("person") or {}).get("id", "")), s


def ts(v):
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


nt, nid, s1 = login("namitest"); jt, jid, s2 = login("jantest")
check("login namitest/jantest", nt and jt and nid and jid, f"{s1}/{s2}")
if not (nt and jt): sys.exit(1)
_, dev = sql(f"select count(*)::int as n from device_tokens where owner = '{jid}' and enabled")
phones = int(dev[0]["n"]) if isinstance(dev, list) and dev else -1
_, dr = sql(f"select text, reply_to from drafts where owner = '{nid}' and other = '{jid}'")
draft = dr[0] if isinstance(dr, list) and dr else None
made: list[str] = []
try:
    later = (datetime.now(timezone.utc) + timedelta(hours=26)).replace(microsecond=0)
    s, j = call("POST", "/bridges", {"person_id": jid, "original": "Probe: for tomorrow.", "used": "mine", "deliver_at": later.isoformat().replace("+00:00", "Z"), "heads_up": False}, nt)
    b = j.get("bridge") or {}
    if b.get("id"): made.append(str(b["id"]))
    check("later send: deliver_at as chosen, not delivered, held_by_window false",
          s == 200 and b.get("deliver_at") and ts(b["deliver_at"]) == later and b.get("delivered") is False and j.get("held_by_window") is False,
          f"{s} deliver_at={b.get('deliver_at')} held={j.get('held_by_window')}")
    if b.get("id"):
        moved = later + timedelta(hours=1)
        s, j = call("PATCH", f"/bridges/{b['id']}", {"deliver_at": moved.isoformat().replace("+00:00", "Z")}, nt)
        check("PATCH reply carries held_by_window false and the moved time", s == 200 and j.get("held_by_window") is False and ts((j.get("bridge") or {}).get("deliver_at")) == moved, f"{s}")
    if phones == 0:
        before = datetime.now(timezone.utc)
        s, j = call("POST", "/bridges", {"person_id": jid, "original": "Probe: now.", "used": "mine", "deliver_at": "now", "heads_up": False}, nt)
        b = j.get("bridge") or {}
        if b.get("id"): made.append(str(b["id"]))
        at = ts(b["deliver_at"]) if b.get("deliver_at") else None
        check("'now' send: delivered in the same reply, deliver_at is the server's now, held_by_window false",
              s == 200 and at and abs((at - before).total_seconds()) < 30 and b.get("delivered") is True and j.get("held_by_window") is False,
              f"{s} delivered={b.get('delivered')} held={j.get('held_by_window')}")
    else:
        print(f"SKIP 'now' send: jantest has {phones} enabled device token(s) on this server (no push to a phone)")
finally:
    for bid in made:
        sql(f"delete from push_events where subject_id = '{bid}'")
        sql(f"delete from bridges where id = '{bid}' and sender = '{nid}'")
    if draft is not None:  # POST /bridges clears the sender's draft for that person; put it back as it was
        rt = f"'{draft['reply_to']}'" if draft.get("reply_to") else "null"
        sql(f"insert into drafts (owner, other, text, reply_to) values ('{nid}','{jid}',$pq${draft['text']}$pq$,{rt}) on conflict (owner, other) do update set text = excluded.text, reply_to = excluded.reply_to")
    _, left = sql(f"select count(*)::int as n from bridges where sender = '{nid}' and original like 'Probe:%'")
    check("no probe bridges left", isinstance(left, list) and left and int(left[0]["n"]) == 0, str(left)[:40])
bad = [n for n, ok, _ in results if not ok]
print(f"{len(results) - len(bad)}/{len(results)} passed")
sys.exit(1 if bad else 0)
