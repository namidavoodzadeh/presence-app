#!/usr/bin/env python3
"""QA-B278 path on STAGING only: the fictional newcomer account has one Talk with several real turns, then finish, and we
report whether finish returns guess beliefs (cards). Prints counts, states and timings only, never the words or a secret.

    python3 next/scripts/probe_staging_talk.py            # 5 turns on the saved newcomer account, then finish
    python3 next/scripts/probe_staging_talk.py --fresh    # a brand-new newcomer first
No hosted code, no hosted write; the newcomer is account_kind test.
"""
from __future__ import annotations
import json, os, sys, time, urllib.request, urllib.error
from pathlib import Path

os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging_newcomer as sn  # noqa: E402
import seed_preview as sp  # noqa: E402
from staging_setup import STAGING, load as load_env  # noqa: E402
from supabase_api import run_sql  # noqa: E402

TURNS = [  # fictional
    "My sister changed the plan for Sunday again and I only found out from the group chat.",
    "I said it was fine. I always say it's fine, then I spend the evening annoyed with myself.",
    "Last month my manager moved my deadline up and I stayed late three nights instead of telling her it was too much.",
    "I think if I say no, people will decide I'm hard to deal with, so I just take the extra and keep quiet.",
    "At the end of it nobody even noticed. That's the part that stings, honestly. I do everything and it just disappears.",
]


def main(argv: list[str]) -> int:
    env = load_env(STAGING)
    if sp.load()["SUPABASE_PROJECT_REF"] != env["SUPABASE_PROJECT_REF"]:
        print("refusing: the loaded project is not the staging project"); return 1
    email, password = sn.credentials(env, "--fresh" in argv)
    uid = sp.ensure_user(env, email, password, "newcomer")
    code, _ = run_sql(env, sn.profile_sql(uid))
    token = sn.sign_in(env, email, password)
    if code not in (200, 201) or not token:
        print("FAIL sign-in/profile", code); return 1
    base = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"

    def call(path, body):
        h = {"content-type": "application/json", "apikey": env["SUPABASE_ANON_KEY"], "authorization": "Bearer " + token}
        req = urllib.request.Request(base + path, method="POST", headers=h, data=json.dumps(body).encode())
        t = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.loads(r.read() or b"{}"), time.monotonic() - t
        except urllib.error.HTTPError as e:
            try: return e.code, json.loads(e.read() or b"{}"), time.monotonic() - t
            except Exception: return e.code, {}, time.monotonic() - t

    cid, cards, ok = None, 0, True
    for i, text in enumerate(TURNS, 1):
        s, j, dt = call("/talk/turn", {"conversation_id": cid, "text": text, "mode": "text"})
        conv = j.get("conversation") or {}
        cid = cid or conv.get("id")
        reply = j.get("reply") or {}
        n = len(reply.get("cards") or [])
        cards += n
        print(f"turn {i}: HTTP {s}, {dt:.1f} s, state={reply.get('state')}, cards={n}")
        if reply.get("state") == "consent":
            s, j, dt = call("/talk/consent", {"conversation_id": cid, "area": (reply.get("consent") or {}).get("area", "body"), "label": "this", "answer": "never"})
            print(f"  consent answered never: HTTP {s}")
        ok &= s == 200 and bool(cid)
    s, j, dt = call("/talk/finish", {"conversation_id": cid, "ratings": []})
    beliefs = j.get("beliefs") or []
    print(f"finish: HTTP {s}, {dt:.1f} s, added={j.get('added')}, to_confirm={j.get('to_confirm')}, beliefs={len(beliefs)}, statuses={sorted({str(b.get('status')) for b in beliefs})}, summary={'yes' if j.get('summary') else 'no'}")
    print("RESULT", "OK: finish returns beliefs" if s == 200 and beliefs else "NO CARD")
    return 0 if ok and s == 200 and beliefs else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
