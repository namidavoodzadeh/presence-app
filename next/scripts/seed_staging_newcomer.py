#!/usr/bin/env python3
"""Friends' gate line 2 (option c): one brand-new fictional account on STAGING, as if just created by a first Apple sign-in, then probe sign-in and first-run.

    python3 next/scripts/seed_staging_newcomer.py            # create (or reuse) newcomer@staging.presence.invalid, probe, print PASS/FAIL
    python3 next/scripts/seed_staging_newcomer.py --fresh    # a new random address each time (a person never seen before)
    python3 next/scripts/seed_staging_newcomer.py --dry-run

The account has a profile exactly as /auth/apple would insert it (name "You", adult confirmed, terms version, account_kind 'test') and NO
map, no conversation, no link: the state of a first launch. It signs in with a password through Supabase's own password grant, then the
probe calls the staging api with that token: GET /me, GET /home, GET /people, one empty onboarding opener (nothing stored).
Password and address are kept in staging.env (PRESENCE_NEWCOMER_EMAIL / PRESENCE_NEWCOMER_PASSWORD); no value is printed.
Refuses to run unless the loaded project is the staging one. No hosted code, no hosted write.
"""
from __future__ import annotations
import json, os, secrets, sys, urllib.request, urllib.error
from pathlib import Path

os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import seed_preview as sp  # noqa: E402
from staging_setup import STAGING, load as load_env  # noqa: E402
from supabase_api import run_sql  # noqa: E402

TERMS_VERSION = "2026-10-29"  # next/api/auth.ts


def _remember(key: str, value: str) -> None:
    with STAGING.open("a") as f:
        f.write(f"\n{key}={value}\n")


def credentials(env: dict[str, str], fresh: bool) -> tuple[str, str]:
    email, password = env.get("PRESENCE_NEWCOMER_EMAIL"), env.get("PRESENCE_NEWCOMER_PASSWORD")
    if email and password and not fresh:
        return email, password
    email = f"newcomer-{secrets.token_hex(4)}@staging.presence.invalid" if fresh else "newcomer@staging.presence.invalid"
    password = secrets.token_urlsafe(24)
    _remember("PRESENCE_NEWCOMER_EMAIL", email)
    _remember("PRESENCE_NEWCOMER_PASSWORD", password)
    return email, password


def profile_sql(uid: str) -> str:
    return ("insert into profiles (id, name, is_example, is_practice, is_preview, auth_provider, adult_confirmed_at, terms_version, account_kind, settings) values "
            f"({sp.q(uid)}, 'You', false, false, false, 'apple', now(), {sp.q(TERMS_VERSION)}, 'test', {sp.q(sp.DEFAULT_SETTINGS)}) "
            "on conflict (id) do update set account_kind = 'test';")


def sign_in(env: dict[str, str], email: str, password: str) -> str:
    req = urllib.request.Request(env["SUPABASE_URL"].rstrip("/") + "/auth/v1/token?grant_type=password", method="POST",
                                 data=json.dumps({"email": email, "password": password}).encode(),
                                 headers={"apikey": env["SUPABASE_ANON_KEY"], "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return str(json.loads(r.read()).get("access_token", ""))
    except urllib.error.HTTPError:
        return ""


def main(argv: list[str]) -> int:
    dry, fresh = "--dry-run" in argv, "--fresh" in argv
    env = load_env(STAGING)
    if sp.load()["SUPABASE_PROJECT_REF"] != env["SUPABASE_PROJECT_REF"]:
        print("refusing: the loaded project is not the staging project"); return 1
    if dry:
        print("plan: one auth user + one first-launch profile on staging (account_kind test), then probe"); return 0
    email, password = credentials(env, fresh)
    uid = sp.ensure_user(env, email, password, "newcomer")
    code, body = run_sql(env, profile_sql(uid))
    print("profile", code, "" if code in (200, 201) else body[:200])
    if code not in (200, 201):
        return 1
    token = sign_in(env, email, password)
    base = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
    ok_all = bool(token)
    print(("PASS" if token else "FAIL"), "password sign-in returns a session")

    def call(method, path, body=None):
        h = {"content-type": "application/json", "apikey": env["SUPABASE_ANON_KEY"], "authorization": "Bearer " + token}
        req = urllib.request.Request(base + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try: return e.code, json.loads(e.read() or b"{}")
            except Exception: return e.code, {}

    if token:
        s, me = call("GET", "/me")
        person = ((me.get("me") or {}).get("person") or {}) if isinstance(me, dict) else {}
        checks = [("GET /me 200, the person is this account", s == 200 and person.get("id") == uid, str(s))]
        s, j = call("GET", "/home"); checks.append(("GET /home 200 with no people", s == 200, str(s)))
        s, j = call("GET", "/people"); checks.append(("GET /people 200, empty", s == 200 and not (j.get("people") if isinstance(j, dict) else j), str(s)))
        s, j = call("GET", "/kennings"); checks.append(("GET /kennings 200, empty map", s == 200, str(s)))
        s, j = call("POST", "/talk/turn", {"conversation_id": None, "text": "", "source": "onboarding"})
        checks.append(("onboarding opener: a question, nothing stored", s == 200 and j.get("opener") is True and j.get("conversation") is None, str(s)))
        for name, ok, detail in checks:
            print(("PASS " if ok else "FAIL ") + name + f"  [{detail}]"); ok_all &= bool(ok)
    return 0 if ok_all else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
