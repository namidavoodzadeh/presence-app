#!/usr/bin/env python3
"""Three brand-new fictional throwaway accounts on STAGING (COO 17:20Z 15 Nov, READY 1; app's Q-APP-FG2-1), for QA's fresh-install replay.

    python3 next/scripts/mint_fresh_staging_accounts.py            # mint FRESH_LIGHT, FRESH_DARK and FRESH_TL1
    python3 next/scripts/mint_fresh_staging_accounts.py --remove   # delete both (auth user + profile) and the env file after QA's replay
    python3 next/scripts/mint_fresh_staging_accounts.py --dry-run

Each account is what a first Apple sign-in leaves before onboarding: an auth user plus a profile (name "You", adult confirmed, terms version,
account_kind 'test') and nothing else. Values go to ~/Library/Application Support/PresenceHome/secrets/fresh-accounts-staging.env, mode 600
(FRESH_LIGHT_/FRESH_DARK_/FRESH_TL1_ EMAIL/PASSWORD, plus the ids for --remove); nothing secret is printed. Refuses unless the loaded
project is the staging one. No AI call, no hosted write.
"""
from __future__ import annotations
import os, secrets, sys
from pathlib import Path

os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import seed_preview as sp  # noqa: E402
from seed_staging_newcomer import profile_sql  # noqa: E402
from staging_setup import STAGING, load as load_env  # noqa: E402
from supabase_api import run_sql  # noqa: E402

OUT = Path.home() / "Library/Application Support/PresenceHome/secrets/fresh-accounts-staging.env"
SLOTS = ("LIGHT", "DARK", "TL1")   # TL1: the account for app's total-limit walk (COO 20:20Z); the first two feed friends-first-signin.sh


def new_credentials() -> dict[str, str]:
    """Random addresses on the reserved .invalid domain and strong passwords; nothing reusable, nothing real."""
    out: dict[str, str] = {}
    for slot in SLOTS:
        out[f"FRESH_{slot}_EMAIL"] = f"fresh-{slot.lower()}-{secrets.token_hex(4)}@staging.presence.invalid"
        out[f"FRESH_{slot}_PASSWORD"] = secrets.token_urlsafe(24)
    return out


def write_env(path: Path, values: dict[str, str]) -> None:
    """Mode 600 from the first byte (no moment when the file is world-readable)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("".join(f"{k}={v}\n" for k, v in values.items()))
    os.chmod(path, 0o600)


def read_env(path: Path) -> dict[str, str]:
    return dict(l.split("=", 1) for l in path.read_text().splitlines() if "=" in l) if path.exists() else {}


def staging_env() -> dict[str, str] | None:
    env = load_env(STAGING)
    return env if sp.load()["SUPABASE_PROJECT_REF"] == env["SUPABASE_PROJECT_REF"] else None


def mint(env: dict[str, str]) -> int:
    if OUT.exists():
        print(f"refusing: {OUT.name} exists; run --remove first (one set at a time)"); return 1
    values = new_credentials()
    for slot in SLOTS:
        uid = sp.ensure_user(env, values[f"FRESH_{slot}_EMAIL"], values[f"FRESH_{slot}_PASSWORD"], "fresh")
        values[f"FRESH_{slot}_ID"] = uid
        write_env(OUT, values)       # after each account, so a failure on the second still leaves the first removable
        code, body = run_sql(env, profile_sql(uid))
        if code not in (200, 201):
            print(f"profile {slot} failed: {code} {str(body)[:120]}"); return 1
    print(f"minted {len(SLOTS)} accounts on staging; keys written to {OUT.name} (mode 600)")
    return 0


def remove(env: dict[str, str]) -> int:
    have = read_env(OUT)
    if not have:
        print("nothing to remove"); return 0
    bad = 0
    for slot in SLOTS:
        uid = have.get(f"FRESH_{slot}_ID")
        if not uid:
            continue
        code, _ = run_sql(env, f"delete from profiles where id = {sp.q(uid)} and account_kind = 'test';")
        acode, _ = sp.auth_call(env, "DELETE", f"/auth/v1/admin/users/{uid}")
        if code not in (200, 201) or acode not in (200, 204):
            print(f"{slot}: profile {code}, auth {acode}"); bad += 1
    if not bad:
        OUT.unlink()
    print("removed" if not bad else "some removals failed; file kept")
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    if "--dry-run" in argv:
        print("plan: three auth users + first-launch profiles (account_kind test) on staging; credentials to fresh-accounts-staging.env, mode 600"); return 0
    env = staging_env()
    if env is None:
        print("refusing: the loaded project is not the staging project"); return 1
    return remove(env) if "--remove" in argv else mint(env)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
