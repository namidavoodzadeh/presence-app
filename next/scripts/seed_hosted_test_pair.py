#!/usr/bin/env python3
"""Two fictional, never-linked HOSTED test accounts for QA's B403/B404 probes (COO 19:25Z 17 Nov, Q-ENG-HOSTED-TESTPAIR: YES).

    python3 next/scripts/seed_hosted_test_pair.py seed      # create the two accounts (refuses if a pair file already exists)
    python3 next/scripts/seed_hosted_test_pair.py check     # ids exist? any link or invite row on them? (counts only)
    python3 next/scripts/seed_hosted_test_pair.py remove    # delete both (profile + auth user), only the ids in the pair file, only account_kind 'test'

Each account is an auth user plus a first-launch profile (account_kind 'test', is_preview false, no link, no invite). Credentials and ids go to
ops/secrets/hosted-test-pair.env (mode 600, gitignored); nothing secret is printed. Production keys come only through the one loader
(step hosted_test_pair). No schema, code or other user rows change; no AI call.
"""
from __future__ import annotations
import json
import os, re, secrets, sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

NAMES = {"A": "Tove (test)", "B": "Elio (test)"}
COLORS = {"A": "#8A6F4E", "B": "#4E7F8A"}
TOVE_NAME = "Tove (test phone)"
TOVE_COLOR = "#8A6F4E"
TERMS_VERSION = "2026-10-29"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def pair_file() -> Path:
    root = Path(os.environ.get("PRESENCE_REPO_ROOT", HERE.parents[1]))
    if "PRESENCE_REPO_ROOT" not in os.environ and root.parent.name == "work":   # a lane worktree: the credentials live in the main checkout, where QA reads them
        root = root.parent.parent
    return root / "ops/secrets/hosted-test-pair.env"


def tove_file() -> Path:
    """The K-0164 phone credential stays with the worktree that seeded it."""
    root = Path(os.environ.get("PRESENCE_REPO_ROOT", HERE.parents[1]))
    return root / "ops/secrets/two-phone-tove.env"


def new_credentials() -> dict[str, str]:
    """Random addresses on the reserved .invalid domain and strong passwords; nothing reusable, nothing real."""
    out: dict[str, str] = {}
    for k in "AB":
        out[f"HOSTED_PAIR_{k}_EMAIL"] = f"hosted-pair-{k.lower()}-{secrets.token_hex(4)}@hosted.presence.invalid"
        out[f"HOSTED_PAIR_{k}_PASSWORD"] = secrets.token_urlsafe(24)
    return out


def new_tove_credentials() -> dict[str, str]:
    return {
        "PRESENCE_TOVE_EMAIL": f"two-phone-tove-{secrets.token_hex(4)}@hosted.presence.invalid",
        "PRESENCE_TOVE_PASSWORD": secrets.token_urlsafe(24),
    }


def write_env(path: Path, values: dict[str, str]) -> None:
    """Mode 600 from the first byte."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("".join(f"{k}={v}\n" for k, v in values.items()))
    os.chmod(path, 0o600)


def read_env(path: Path) -> dict[str, str]:
    return dict(l.split("=", 1) for l in path.read_text().splitlines() if "=" in l) if path.exists() else {}


def profile_sql(q, default_settings, uid: str, name: str, color: str) -> str:
    if not UUID.match(uid or ""):
        raise ValueError("profile needs a uuid")
    return ("insert into profiles (id, name, color, is_example, is_practice, is_preview, auth_provider, adult_confirmed_at, terms_version, account_kind, settings) values "
            f"({q(uid)}, {q(name)}, {q(color)}, false, false, false, 'apple', now(), {q(TERMS_VERSION)}, 'test', {q(default_settings)}) "
            f"on conflict (id) do update set name = excluded.name, account_kind = 'test';")


def left_sql(q, ids: list[str]) -> str:
    if not ids or not all(UUID.match(i or "") for i in ids):
        raise ValueError("check needs uuids")
    lst = ", ".join(q(i) for i in ids)
    return (f"select (select count(*) from profiles where id in ({lst})) as profiles, "
            f"(select count(*) from links where person_a in ({lst}) or person_b in ({lst})) as links, "
            f"(select count(*) from invites where owner in ({lst}) or accepted_by in ({lst})) as invites;")


def password_sign_in(env: dict[str, str], email: str, password: str) -> int:
    """Authenticate through hosted Auth with the account password; never return its body."""
    req = urllib.request.Request(
        env["SUPABASE_URL"] + "/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": password}).encode(),
        method="POST",
    )
    req.add_header("apikey", env["SUPABASE_ANON_KEY"])
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            response.read()
            return response.status
    except urllib.error.HTTPError as error:
        error.read()
        return error.code


def seed_tove(env, sp, run_sql, sign_in=password_sign_in) -> tuple[str, int]:
    """Create exactly one unlinked hosted test account for the two-phone setup."""
    path = tove_file()
    if path.exists():
        raise SystemExit(f"refusing: {path.name} exists; do not replace a phone credential")
    values = new_tove_credentials()
    uid = sp.ensure_user(env, values["PRESENCE_TOVE_EMAIL"], values["PRESENCE_TOVE_PASSWORD"], "two-phone-tove")
    values["PRESENCE_TOVE_ID"] = uid
    write_env(path, values)
    code, _ = run_sql(env, profile_sql(sp.q, sp.DEFAULT_SETTINGS, uid, TOVE_NAME, TOVE_COLOR))
    if code not in (200, 201):
        raise SystemExit(f"profile write failed: HTTP {code}; credential retained for removal")
    code, body = run_sql(env, left_sql(sp.q, [uid]))
    try:
        counts = json.loads(body)[0]
    except (IndexError, TypeError, ValueError):
        counts = {}
    if code not in (200, 201) or counts.get("profiles") != 1 or counts.get("links") != 0 or counts.get("invites") != 0:
        raise SystemExit(f"unlinked-account check failed: HTTP {code}; credential retained for removal")
    return uid, sign_in(env, values["PRESENCE_TOVE_EMAIL"], values["PRESENCE_TOVE_PASSWORD"])


def seed(env, sp, run_sql) -> int:
    path = pair_file()
    if path.exists():
        print(f"refusing: {path.name} exists; run remove first (one pair at a time)"); return 1
    values = new_credentials()
    for k in "AB":
        uid = sp.ensure_user(env, values[f"HOSTED_PAIR_{k}_EMAIL"], values[f"HOSTED_PAIR_{k}_PASSWORD"], f"hosted-pair-{k.lower()}")
        values[f"HOSTED_PAIR_{k}_ID"] = uid
        write_env(path, values)        # after each account, so a failure on the second still leaves the first removable
        code, body = run_sql(env, profile_sql(sp.q, sp.DEFAULT_SETTINGS, uid, NAMES[k], COLORS[k]))
        print(f"profile {NAMES[k]}", code)
        if code not in (200, 201):
            print(str(body)[:200]); return 1
    print(f"seeded 2 test accounts on hosted; credentials in {path.name} (mode 600)")
    return 0


def check(env, sp, run_sql) -> int:
    have = read_env(pair_file())
    ids = [have[f"HOSTED_PAIR_{k}_ID"] for k in "AB" if have.get(f"HOSTED_PAIR_{k}_ID")]
    if not ids:
        print("no pair file or no ids"); return 1
    code, body = run_sql(env, left_sql(sp.q, ids))
    print("check", code, body[:200])
    return 0 if code in (200, 201) else 1


def remove(env, sp, run_sql) -> int:
    path = pair_file()
    have = read_env(path)
    if not have:
        print("nothing to remove"); return 0
    bad = 0
    for k in "AB":
        uid = have.get(f"HOSTED_PAIR_{k}_ID")
        if not uid:
            continue
        if not UUID.match(uid):
            print(f"{k}: bad id in file"); bad += 1; continue
        code, _ = run_sql(env, f"delete from profiles where id = {sp.q(uid)} and account_kind = 'test';")
        acode, _ = sp.auth_call(env, "DELETE", f"/auth/v1/admin/users/{uid}")
        if code not in (200, 201) or acode not in (200, 204, 404):
            print(f"{k}: profile {code}, auth {acode}"); bad += 1
    if not bad:
        path.unlink()
    print("removed" if not bad else "some removals failed; file kept")
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "check"
    if cmd not in ("seed", "check", "remove", "tove"):
        print(__doc__); return 2
    import seed_preview as sp  # noqa: E402
    from supabase_api import run_sql  # noqa: E402
    from supabase_env import load_production  # noqa: E402
    env = load_production("hosted_test_pair")
    if cmd == "tove":
        uid, status = seed_tove(env, sp, run_sql)
        print(f"tove account {uid}; hosted sign-in HTTP {status}")
        return 0 if status in (200, 201) else 1
    return {"seed": seed, "check": check, "remove": remove}[cmd](env, sp, run_sql)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
