#!/usr/bin/env python3
"""Friends' gate line 1, server half: a new card for jantest queues exactly one push for its device token, and the payload
carries what the app needs to open that card (route bridge_thread, target_id = sender, card_id = the bridge id, no words).

    python3 next/scripts/probe_card_push.py            # staging: sends a probe card to jantest
    python3 next/scripts/probe_card_push.py --hosted   # production: READ-ONLY configuration check, no write at all

Staging adds a fake, disabled-after-use device token for jantest (never a real phone) and removes it, the push rows and the
probe card at the end. Never prints a secret or a token.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
HOSTED = "--hosted" in sys.argv
if not HOSTED:
    os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
from supabase_api import run_sql  # noqa: E402
from supabase_env import load_for_step  # noqa: E402

env = load_for_step("seed_test_contact")
results: list[tuple[str, bool, str]] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail)); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def sql(q):
    st, body = run_sql(env, q)
    try: return st, json.loads(body) if isinstance(body, str) else body
    except ValueError: return st, body


if HOSTED:
    _, t = sql("select count(*)::int as n from pg_trigger where tgname in ('messages_push_event','bridges_push_event') and not tgisinternal")
    _, t2 = sql("select tgname from pg_trigger where tgrelid = 'public.bridges'::regclass and not tgisinternal")
    check("hosted: push trigger on bridges present", any("push" in str(r.get("tgname")) for r in (t2 if isinstance(t2, list) else [])), str(t2)[:80])
    _, j = sql("select jobname, schedule, active from cron.job where command ilike '%push%' or jobname ilike '%push%'")
    check("hosted: push drain scheduled and active", isinstance(j, list) and any(r.get("active") for r in j), str([(r.get('jobname'), r.get('schedule')) for r in j] if isinstance(j, list) else j)[:100])
    _, sec = sql("select name from vault.decrypted_secrets where name like 'presence_push_%' order by name")
    check("hosted: drain secrets in vault (names only)", isinstance(sec, list) and len(sec) >= 3, str([r.get("name") for r in sec] if isinstance(sec, list) else sec)[:100])
    _, d = sql("select count(*)::int as n, count(*) filter (where enabled)::int as enabled from device_tokens")
    print("INFO hosted device tokens (count only):", d)
    bad = [n for n, ok, _ in results if not ok]
    print(f"{len(results) - len(bad)}/{len(results)} passed"); sys.exit(1 if bad else 0)

BASE = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
m = re.search(r"^PRESENCE_PREVIEW_DEVICE_SECRET=(\S+)", (Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome")) / "secrets/staging.env").read_text(), re.M)
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
check("login namitest/jantest", nt and jt and nid and jid)
if not (nt and jt): sys.exit(1)
_, dr = sql(f"select text, reply_to from drafts where owner = '{nid}' and other = '{jid}'")
draft = dr[0] if isinstance(dr, list) and dr else None
bid = None
inst = "00000000-0000-4000-8000-0000000c4a2d"
try:
    sql(f"delete from device_tokens where owner = '{jid}' and installation_id = '{inst}'")
    sql(f"insert into device_tokens (owner, installation_id, token, token_hash, environment, bundle_id) values ('{jid}','{inst}','{'ab'*40}','probe-card-push-hash','sandbox','com.namidavoodzadeh.presence.qa')")
    s, j = call("POST", "/bridges", {"person_id": jid, "original": "Probe: a card for the push.", "used": "mine", "deliver_at": "now", "heads_up": False}, nt)
    bid = str((j.get("bridge") or {}).get("id", ""))
    check("card sent", s == 200 and bid, str(s))
    _, rows = sql(f"select p.kind, p.subject_id, p.route_target_id, p.state from push_events p join device_tokens d on d.id = p.device_id where d.owner = '{jid}' and d.installation_id = '{inst}' and p.subject_id = '{bid}'")
    rows = rows if isinstance(rows, list) else []
    check("exactly one push queued for the device token", len(rows) == 1, f"{len(rows)} rows")
    r = rows[0] if rows else {}
    check("kind bridge_ready, aimed at the sender", r.get("kind") == "bridge_ready" and r.get("route_target_id") == nid, str(r.get("kind")))
    check("subject is the card (bridge) id", r.get("subject_id") == bid)
finally:
    if bid:
        sql(f"delete from push_events where subject_id = '{bid}'")
        sql(f"delete from bridges where id = '{bid}' and sender = '{nid}'")
    sql(f"delete from push_events where device_id in (select id from device_tokens where owner = '{jid}' and installation_id = '{inst}')")
    sql(f"delete from device_tokens where owner = '{jid}' and installation_id = '{inst}'")
    if draft is not None:
        rt = f"'{draft['reply_to']}'" if draft.get("reply_to") else "null"
        sql(f"insert into drafts (owner, other, text, reply_to) values ('{nid}','{jid}',$pq${draft['text']}$pq$,{rt}) on conflict (owner, other) do update set text = excluded.text, reply_to = excluded.reply_to")
    _, left = sql(f"select (select count(*) from bridges where sender = '{nid}' and original like 'Probe:%')::int as b, (select count(*) from device_tokens where owner = '{jid}' and installation_id = '{inst}')::int as t")
    check("no probe rows left", isinstance(left, list) and left and left[0]["b"] == 0 and left[0]["t"] == 0, str(left)[:60])
bad = [n for n, ok, _ in results if not ok]
print(f"{len(results) - len(bad)}/{len(results)} passed"); sys.exit(1 if bad else 0)
