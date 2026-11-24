#!/usr/bin/env python3
"""Friends' gate line 3 (Q-APP-INV-1 option d): two fictional, never-linked STAGING personas for the invite walk, and a clean command.

    python3 next/scripts/staging_pair.py seed      # create (or reuse) the two personas; no link, no invite
    python3 next/scripts/staging_pair.py clean     # hard-delete the links and invite rows between those two ONLY
    python3 next/scripts/staging_pair.py check     # exit 0 when nothing is between them
    python3 next/scripts/staging_pair.py probe     # link (accept_invite), clean, clean again; exit 0 when all three behave

Personas: "Pia (test)" and "Rey (test)", account_kind 'test', first-launch profiles, password sign-in on staging.
Credentials live in staging.env (PRESENCE_PAIR_A_*, PRESENCE_PAIR_B_*); no value is printed.
`clean` deletes rows in `links` whose two ends are exactly these two ids, and rows in `invites` owned by either of them whose
accepted_by is the other one or null (an unused code of theirs). It takes no id argument, so it cannot touch any other account, and it
refuses to run unless the loaded Supabase project is the staging one. Nothing here touches hosted.
"""
from __future__ import annotations
import json, os, re, secrets, sys, urllib.request, urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

NAMES = {"A": "Pia (test)", "B": "Rey (test)"}
COLORS = {"A": "#7A5C9E", "B": "#4C8C7A"}
TERMS_VERSION = "2026-10-29"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def clean_sql(q, a: str, b: str) -> str:
    """Delete only what sits between a and b. Refuses anything that is not two distinct uuids."""
    if not (UUID.match(a or "") and UUID.match(b or "") and a != b):
        raise ValueError("clean needs the two persona ids")
    return "\n".join([
        "begin;",
        f"delete from links where (person_a = {q(a)} and person_b = {q(b)}) or (person_a = {q(b)} and person_b = {q(a)});",
        f"delete from invites where (owner = {q(a)} and (accepted_by = {q(b)} or accepted_by is null)) "
        f"or (owner = {q(b)} and (accepted_by = {q(a)} or accepted_by is null));",
        "commit;",
    ])


def left_sql(q, a: str, b: str) -> str:
    if not (UUID.match(a or "") and UUID.match(b or "") and a != b):
        raise ValueError("check needs the two persona ids")
    return (f"select (select count(*) from links where (person_a = {q(a)} and person_b = {q(b)}) or (person_a = {q(b)} and person_b = {q(a)})) as links, "
            f"(select count(*) from invites where (owner = {q(a)} and (accepted_by = {q(b)} or accepted_by is null)) "
            f"or (owner = {q(b)} and (accepted_by = {q(a)} or accepted_by is null))) as invites;")


def profile_sql(q, sp, uid: str, name: str, color: str) -> str:
    return ("insert into profiles (id, name, color, is_example, is_practice, is_preview, auth_provider, adult_confirmed_at, terms_version, account_kind, settings) values "
            f"({q(uid)}, {q(name)}, {q(color)}, false, false, false, 'apple', now(), {q(TERMS_VERSION)}, 'test', {q(sp.DEFAULT_SETTINGS)}) "
            f"on conflict (id) do update set name = excluded.name, account_kind = 'test';")


def _setup():
    os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
    import seed_preview as sp
    from staging_setup import STAGING, load as load_env
    from supabase_api import run_sql
    env = load_env(STAGING)
    if sp.load()["SUPABASE_PROJECT_REF"] != env["SUPABASE_PROJECT_REF"]:
        raise SystemExit("refusing: the loaded project is not the staging project")
    return sp, STAGING, env, run_sql


def _creds(env, STAGING, k: str):
    ek, pk = f"PRESENCE_PAIR_{k}_EMAIL", f"PRESENCE_PAIR_{k}_PASSWORD"
    if env.get(ek) and env.get(pk):
        return env[ek], env[pk]
    email, pw = f"pair-{k.lower()}-{secrets.token_hex(3)}@staging.presence.invalid", secrets.token_urlsafe(24)
    with STAGING.open("a") as f:
        f.write(f"\n{ek}={email}\n{pk}={pw}\n")
    env[ek], env[pk] = email, pw
    return email, pw


def ids(sp, env, STAGING):
    out = {}
    for k in "AB":
        email, pw = _creds(env, STAGING, k)
        out[k] = sp.ensure_user(env, email, pw, f"pair-{k.lower()}")
    return out


def _count(run_sql, env, a, b, q):
    code, body = run_sql(env, left_sql(q, a, b))
    if code not in (200, 201):
        raise SystemExit(f"check failed: {code}")
    row = json.loads(body)[0]
    return int(row["links"]), int(row["invites"])


def _sign_in(env, k, STAGING):
    email, pw = _creds(env, STAGING, k)
    req = urllib.request.Request(env["SUPABASE_URL"].rstrip("/") + "/auth/v1/token?grant_type=password", method="POST",
                                 data=json.dumps({"email": email, "password": pw}).encode(),
                                 headers={"apikey": env["SUPABASE_ANON_KEY"], "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read()).get("access_token", "")


def _api(env, token, method, path, body=None):
    base = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
    h = {"content-type": "application/json", "apikey": env["SUPABASE_ANON_KEY"], "authorization": "Bearer " + token}
    req = urllib.request.Request(base + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "check"
    if cmd not in ("seed", "clean", "check", "probe"):
        print(__doc__); return 2
    sp, STAGING, env, run_sql = _setup()
    q = sp.q
    p = ids(sp, env, STAGING)
    a, b = p["A"], p["B"]
    if cmd in ("seed", "probe"):
        for k in "AB":
            code, body = run_sql(env, profile_sql(q, sp, p[k], NAMES[k], COLORS[k]))
            print(f"profile {NAMES[k]}", code)
            if code not in (200, 201): print(body[:200]); return 1
        if cmd == "seed":
            print("names:", NAMES["A"], "and", NAMES["B"], "; command: python3 next/scripts/staging_pair.py clean"); return 0
    if cmd == "clean":
        code, body = run_sql(env, clean_sql(q, a, b)); print("clean", code)
        return 0 if code in (200, 201) else 1
    if cmd == "check":
        l, i = _count(run_sql, env, a, b, q); print(f"between them: {l} link, {i} invite rows")
        return 0 if (l, i) == (0, 0) else 1
    # probe: link through the real invite routes, clean, clean again
    ok = True
    def step(name, good, detail=""):
        nonlocal ok; ok &= bool(good); print(("PASS " if good else "FAIL ") + name + (f"  [{detail}]" if detail else ""))
    run_sql(env, clean_sql(q, a, b))
    ta, tb = _sign_in(env, "A", STAGING), _sign_in(env, "B", STAGING)
    step("both sign in", ta and tb)
    s, j = _api(env, ta, "POST", "/invites", {})
    code = ((j.get("invite") or j) or {}).get("code")
    step("A creates an invite", s in (200, 201) and code, str(s))
    s, j = _api(env, tb, "POST", f"/invites/{code}/accept", {})
    step("B accepts it", s in (200, 201), str(s))
    l, i = _count(run_sql, env, a, b, q); step("linked: 1 link, 1 invite row", (l, i) == (1, 1), f"{l},{i}")
    code1, _ = run_sql(env, clean_sql(q, a, b)); l, i = _count(run_sql, env, a, b, q)
    step("clean: nothing between them", code1 in (200, 201) and (l, i) == (0, 0), f"{l},{i}")
    code2, _ = run_sql(env, clean_sql(q, a, b)); l, i = _count(run_sql, env, a, b, q)
    step("clean again: still nothing, no error", code2 in (200, 201) and (l, i) == (0, 0), f"{l},{i}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
