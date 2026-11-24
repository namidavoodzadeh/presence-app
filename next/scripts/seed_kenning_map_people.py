#!/usr/bin/env python3
"""Kenning map (d-all-kenning-map-14nov): three fictional linked people for the staging test accounts.

    python3 next/scripts/seed_kenning_map_people.py --dry-run
    python3 next/scripts/seed_kenning_map_people.py            # staging ONLY; refuses any other project

Adds Ines (test), Tomas (test) and Dara (test), flagged account_kind 'test', each linked to namitest and jantest
(friend / family / coworker). They hold no map and no beliefs. Never touches Nami's real account (law 10). Idempotent.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

PEOPLE = [  # (persona, name, color, relationship to namitest, relationship to jantest)
    ("inestest", "Ines (test)", "#8A5A7A", "friend", "friend"),
    ("tomastest", "Tomas (test)", "#6B8A4E", "family", "coworker"),
    ("daratest", "Dara (test)", "#B07A3E", "coworker", "friend"),
]
OWNERS = ("namitest", "jantest")


def plan_sql(q, owner_ids: dict[str, str], people_ids: dict[str, str]) -> str:
    sql = ["begin;"]
    for persona, name, color, rel_n, rel_j in PEOPLE:
        pid = people_ids[persona]
        sql.append(f"insert into profiles (id, name, color, is_example, is_practice, is_preview, persona, account_kind) values "
                   f"({q(pid)}, {q(name)}, {q(color)}, false, false, false, {q(persona)}, 'test') "
                   f"on conflict (id) do update set name = excluded.name, color = excluded.color, persona = excluded.persona, account_kind = 'test';")
        for owner, rel in zip(OWNERS, (rel_n, rel_j)):
            oid = owner_ids[owner]
            a, b = sorted((oid, pid))
            sql.append(f"insert into links (person_a, person_b, status) values ({q(a)}, {q(b)}, 'active') "
                       f"on conflict (person_a, person_b) do update set status = 'active';")
            for x, y in ((oid, pid), (pid, oid)):
                sql.append(f"insert into link_prefs (owner, other, relationship) values ({q(x)}, {q(y)}, {q(rel)}) "
                           f"on conflict (owner, other) do update set relationship = {q(rel)};")
    sql.append("commit;")
    return "\n".join(sql)


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
    import seed_preview as sp  # noqa: E402
    from staging_setup import STAGING, load as load_env  # noqa: E402
    from supabase_api import run_sql  # noqa: E402
    if dry:
        print(plan_sql(sp.q, {o: f"<{o}>" for o in OWNERS}, {p[0]: f"<{p[0]}>" for p in PEOPLE}))
        return 0
    env = load_env(STAGING)
    if sp.load()["SUPABASE_PROJECT_REF"] != env["SUPABASE_PROJECT_REF"]:
        print("refusing: the loaded project is not the staging project")
        return 1
    import json
    code, body = run_sql(env, "select id, persona from profiles where persona in ('namitest','jantest') and account_kind = 'test'")
    rows = json.loads(body) if code in (200, 201) else []
    owner_ids = {r["persona"]: r["id"] for r in rows}
    if set(owner_ids) != set(OWNERS):
        print(f"refusing: staging lacks {sorted(set(OWNERS) - set(owner_ids))}; run seed_test_contact.py first")
        return 1
    people_ids = {p[0]: sp.ensure_user(env, f"{p[0]}@preview.presence.invalid", sp.preview_password(), p[0]) for p in PEOPLE}
    code, body = run_sql(env, plan_sql(sp.q, owner_ids, people_ids))
    print("seed", code, "" if code in (200, 201) else str(body)[:300])
    return 0 if code in (200, 201) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
