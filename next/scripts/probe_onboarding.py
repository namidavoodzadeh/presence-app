#!/usr/bin/env python3
"""Live probe of v1.54/v1.55 onboarding: opener, GET /invites/:code, invite_code on GET /people as namitest/jantest (flagged test accounts). Never prints a secret.

    python3 next/scripts/probe_onboarding.py            # staging
    python3 next/scripts/probe_onboarding.py --hosted   # production (step seed_test_contact loader), fictional belief, deleted after
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
secret_file = Path.home() / "Library/Application Support/PresenceHome/secrets/preview-device.env"
secret = None
if not HOSTED:
    m = re.search(r"^PRESENCE_PREVIEW_DEVICE_SECRET=(\S+)", (Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome")) / "secrets/staging.env").read_text(), re.M)
    secret = m.group(1) if m else None
elif secret_file.exists():
    m = re.search(r"^(?:export\s+)?PRESENCE_PREVIEW_DEVICE_SECRET=[\"']?([^\"'\s]+)", secret_file.read_text(), re.M)
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

def login(p):
    s, j = call("POST", "/preview/login", {"persona": p})
    return str(j.get("access_token", "")), str(((j.get("me") or {}).get("person") or {}).get("id", "")), s

nt, nid, s1 = login("namitest"); jt, jid, s2 = login("jantest")
check("login namitest/jantest", nt and jt and nid and jid, f"{s1}/{s2}")
if not (nt and jt): sys.exit(1)
def sql(q):
    code, text = run_sql(env, q)
    try: return code, json.loads(text)
    except Exception: return code, text
def sql(q):
    code, text = run_sql(env, q)
    try: return code, json.loads(text)
    except Exception: return code, text
def count_conv():
    _, out = sql(f"select count(*) as n from conversations where owner = '{nid}'")
    return int((out[0] if isinstance(out, list) and out else {}).get("n", -1))
inv_id, code = str(uuid.uuid4()), "PRB" + uuid.uuid4().hex[:5].upper()
link_before = None
try:
    c0 = count_conv()
    s, j = call("POST", "/talk/turn", {"conversation_id": None, "text": "", "source": "onboarding"}, nt)
    q = (j.get("reply") or {}).get("question", "")
    check("opener: one question, nothing stored", s == 200 and j.get("opener") is True and j.get("conversation") is None and q.endswith("?") and count_conv() == c0, f"{s}")
    s, j = call("POST", "/talk/turn", {"text": "", "source": "invite", "about": {"name": "Jan", "relationship": "partner"}}, nt)
    check("opener: names the person", s == 200 and "Jan" in (j.get("reply") or {}).get("question", "") and count_conv() == c0, f"{s}")
    s, j = call("POST", "/talk/turn", {"text": "", "source": "invite", "about": {"name": "Jo", "relationship": "enemy"}}, nt)
    check("opener: bad about is 400 invalid", s == 400 and j.get("error") == "invalid", f"{s}")
    # an invite from jantest, peeked by namitest
    code_, _ = sql(f"insert into invites (id, code, owner) values ('{inv_id}', '{code}', '{jid}')")
    check("seed invite", code_ in (200, 201), str(code_))
    s, j = call("GET", f"/invites/{code.lower()}", token=nt)
    check("peek: inviter name, initial, expiry", s == 200 and (j.get("inviter") or {}).get("name") and (j.get("inviter") or {}).get("initial") and j.get("expires_at") and set(j) == {"inviter", "expires_at"}, f"{s}")
    _, out = sql(f"select accepted_by, accepted_at from invites where id = '{inv_id}'")
    check("peek marked nothing", out and out[0].get("accepted_by") is None and out[0].get("accepted_at") is None, str(out)[:80])
    s, j = call("GET", f"/invites/{code}", token=jt); check("peek own code is 400", s == 400, str(s))
    s, j = call("GET", "/invites/ZZZZZZ", token=nt); check("peek unknown is 404", s == 404, str(s))
    sql(f"update invites set expires_at = now() - interval '1 minute' where id = '{inv_id}'")
    s, j = call("GET", f"/invites/{code}", token=nt); check("peek expired is 404", s == 404, str(s))
    # invite_code: link nami-jan made from jan's invite
    a, b = sorted([nid, jid])
    _, out = sql(f"select invite_id from links where person_a = '{a}' and person_b = '{b}'")
    link_before = out[0].get("invite_id") if out else None
    sql(f"update links set invite_id = '{inv_id}' where person_a = '{a}' and person_b = '{b}'")
    s, j = call("GET", "/people", token=jt)
    row = next((p for p in j.get("people", []) if (p.get("person") or {}).get("id") == nid), {})
    check("people: inviter sees invite_code", s == 200 and row.get("invite_code") == code, str(s))
    s, j = call("GET", "/people", token=nt)
    row = next((p for p in j.get("people", []) if (p.get("person") or {}).get("id") == jid), {})
    check("people: joiner sees null", s == 200 and "invite_code" in row and row["invite_code"] is None, str(s))
finally:
    a, b = sorted([nid, jid])
    prev = f"'{link_before}'" if link_before else "null"
    sql(f"update links set invite_id = {prev} where person_a = '{a}' and person_b = '{b}'")
    sql(f"delete from invites where id = '{inv_id}'")
bad = [n for n, ok, _ in results if not ok]
print(f"{len(results) - len(bad)}/{len(results)} passed")
sys.exit(1 if bad else 0)
