#!/usr/bin/env python3
"""Q36: seed the two flagged personas on presence-staging ONLY (fictional; production gets them only after Nami's yes).

    python3 next/scripts/seed_staging_personas.py            # canary + reviewer, each with a cast map, linked to each other
    python3 next/scripts/seed_staging_personas.py --dry-run

Both are fictional (addresses end in @staging.presence.invalid), carry profiles.account_kind ('canary' | 'reviewer', migration 0045)
and a cast persona's confirmed beliefs with receipts. Passwords are random, kept in staging.env as PRESENCE_CANARY_PASSWORD and
PRESENCE_REVIEWER_PASSWORD; no value is printed. Refuses to run unless the loaded project is the staging one.
"""
from __future__ import annotations

import json
import os
import secrets
import sys
from pathlib import Path

os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import seed_preview as sp  # noqa: E402
from staging_setup import STAGING, load as load_env  # noqa: E402
from supabase_api import run_sql  # noqa: E402

PERSONAS = {
    "canary": ("Canary", "#5E7FB0", "mei-nonnative-money"),
    "reviewer": ("Reviewer", "#8A6D3B", "joan-humorous-retirement"),
}


def password_for(kind: str) -> str:
    key = f"PRESENCE_{kind.upper()}_PASSWORD"
    env = load_env(STAGING)
    if env.get(key):
        return env[key]
    value = secrets.token_urlsafe(24)
    with STAGING.open("a") as f:
        f.write(f"\n{key}={value}\n")
    return value


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    env = load_env(STAGING)
    if sp.load()["SUPABASE_PROJECT_REF"] != env["SUPABASE_PROJECT_REF"]:
        print("refusing: the loaded project is not the staging project"); return 1
    personas = {p["id"]: p for p in json.loads((sp.ROOT / "next/fixtures/personas.json").read_text())["personas"]}
    ids = {k: (f"<{k}>" if dry else sp.ensure_user(env, f"{k}@staging.presence.invalid", password_for(k), k)) for k in PERSONAS}
    sql = ["begin;"]
    for kind, (name, color, pid) in PERSONAS.items():
        uid = ids[kind]
        sql.append(f"insert into profiles (id, name, color, is_example, is_practice, is_preview, persona, account_kind, settings) values "
                   f"({sp.q(uid)}, {sp.q(name)}, {sp.q(color)}, false, false, false, {sp.q(kind)}, {sp.q(kind)}, {sp.q(sp.DEFAULT_SETTINGS)}) "
                   f"on conflict (id) do update set name = excluded.name, color = excluded.color, account_kind = excluded.account_kind;")
        for t in ("belief_links", "receipts", "beliefs", "messages", "conversations", "consent", "drafts"):
            sql.append(f"delete from {t} where owner = {sp.q(uid)};")
        sp.seed_cast_map(sql, uid, name, personas[pid], pid)
    a, b = sorted(ids.values())
    sql.append(f"insert into links (person_a, person_b, status) values ({sp.q(a)}, {sp.q(b)}, 'active') on conflict (person_a, person_b) do update set status = 'active';")
    for owner, other in ((ids["canary"], ids["reviewer"]), (ids["reviewer"], ids["canary"])):
        sql.append(f"insert into link_prefs (owner, other, relationship) values ({sp.q(owner)}, {sp.q(other)}, 'friend') "
                   f"on conflict (owner, other) do update set relationship = 'friend';")
    sql.append("commit;")
    print(f"plan: {list(PERSONAS)}; sql {sum(len(s) for s in sql)} chars")
    if dry:
        return 0
    code, body = run_sql(env, "\n".join(sql))
    print("seed", code, "" if code in (200, 201) else body[:300])
    return 0 if code in (200, 201) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
