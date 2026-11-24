#!/usr/bin/env python3
"""Two-phone Bridge (CEO 9 Nov 16:45 PT): the flagged test account "Jan (test)", linked to Nami as partner.

    python3 next/scripts/seed_test_contact.py --dry-run          # print the plan, touch nothing
    python3 next/scripts/seed_test_contact.py                    # staging (the default environment)
    python3 next/scripts/seed_test_contact.py --hosted           # production, through the one key loader (step seed_test_contact)

Jan (test) is the owner's own test contact: it holds no real person's data, no map, no beliefs. It is a normal (not example,
not preview) account so Bridge to it uses the real engine and real pushes; profiles.account_kind = 'test' (migrations 0045 +
0046) keeps it out of friend counts and metrics. Idempotent. Signs in through POST /preview/login {persona: "jantest"}
(email jantest@preview.presence.app, the preview password; the device secret still guards hosted). Prints ids, never a key.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

PERSONA = "jantest"
NAME = "Jan (test)"
COLOR = "#3E7C6B"
EMAIL = f"{PERSONA}@preview.presence.app"
# Second flagged account for the automated two-way BRIDGE-E2E (CEO 9 Nov 17:12 PT): "Nami (test)", partner of Jan (test) only,
# never linked to the real owner.
PERSONA2 = "namitest"
NAME2 = "Nami (test)"
COLOR2 = "#5B6FA8"
EMAIL2 = f"{PERSONA2}@preview.presence.app"


def plan_sql(q, jan_id: str, nami_id: str) -> str:
    """The whole seed as one transaction. `q` is the SQL literal quoter."""
    a, b = sorted((jan_id, nami_id))
    return "\n".join([
        "begin;",
        f"insert into profiles (id, name, color, is_example, is_practice, is_preview, persona, account_kind) values "
        f"({q(jan_id)}, {q(NAME)}, {q(COLOR)}, false, false, false, {q(PERSONA)}, 'test') "
        f"on conflict (id) do update set name = excluded.name, color = excluded.color, is_example = false, is_practice = false, "
        f"is_preview = false, persona = excluded.persona, account_kind = 'test';",
        f"insert into links (person_a, person_b, status) values ({q(a)}, {q(b)}, 'active') "
        f"on conflict (person_a, person_b) do update set status = 'active';",
        f"insert into link_prefs (owner, other, relationship) values ({q(jan_id)}, {q(nami_id)}, 'partner') "
        f"on conflict (owner, other) do update set relationship = 'partner';",
        f"insert into link_prefs (owner, other, relationship) values ({q(nami_id)}, {q(jan_id)}, 'partner') "
        f"on conflict (owner, other) do update set relationship = 'partner';",
        "commit;",
    ])


def plan_pair_sql(q, nami_t_id: str, jan_id: str) -> str:
    """Nami (test) as a flagged test account, linked to Jan (test) as partner, both directions. One transaction."""
    a, b = sorted((nami_t_id, jan_id))
    return "\n".join([
        "begin;",
        f"insert into profiles (id, name, color, is_example, is_practice, is_preview, persona, account_kind) values "
        f"({q(nami_t_id)}, {q(NAME2)}, {q(COLOR2)}, false, false, false, {q(PERSONA2)}, 'test') "
        f"on conflict (id) do update set name = excluded.name, color = excluded.color, is_example = false, is_practice = false, "
        f"is_preview = false, persona = excluded.persona, account_kind = 'test';",
        f"insert into links (person_a, person_b, status) values ({q(a)}, {q(b)}, 'active') "
        f"on conflict (person_a, person_b) do update set status = 'active';",
        f"insert into link_prefs (owner, other, relationship) values ({q(nami_t_id)}, {q(jan_id)}, 'partner') "
        f"on conflict (owner, other) do update set relationship = 'partner';",
        f"insert into link_prefs (owner, other, relationship) values ({q(jan_id)}, {q(nami_t_id)}, 'partner') "
        f"on conflict (owner, other) do update set relationship = 'partner';",
        "commit;",
    ])


def main(argv: list[str]) -> int:
    dry, hosted = "--dry-run" in argv, "--hosted" in argv
    if not hosted:
        os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
    import seed_preview as sp  # noqa: E402
    from supabase_api import run_sql  # noqa: E402
    from supabase_env import load_for_step  # noqa: E402
    env = load_for_step("seed_test_contact")
    where = "production" if hosted else "staging"
    if dry:
        print(f"plan ({where}):\n" + plan_sql(sp.q, "<jan>", "<nami>"))
        print("pair plan:\n" + plan_pair_sql(sp.q, "<nami-test>", "<jan>"))
        return 0
    code, rows = run_sql(env, "select id from profiles where persona = 'nami' and account_kind is null order by created_at limit 2")
    try:
        parsed = json.loads(rows)
    except ValueError:
        parsed = []
    ids = [r["id"] for r in parsed] if code in (200, 201) and isinstance(parsed, list) else []
    if len(ids) != 1:
        print(f"refusing: expected one owner profile (persona nami) on {where}, found {len(ids)} (sql {code})")
        return 1
    jan = sp.ensure_user(env, EMAIL, sp.preview_password(), PERSONA)
    code, body = run_sql(env, plan_sql(sp.q, jan, ids[0]))
    print(f"seed {where}: sql {code}; jan {jan}; owner {ids[0]}" + ("" if code in (200, 201) else f"; {str(body)[:200]}"))
    if code not in (200, 201):
        return 1
    nt = sp.ensure_user(env, EMAIL2, sp.preview_password(), PERSONA2)
    code, body = run_sql(env, plan_pair_sql(sp.q, nt, jan))
    print(f"seed pair {where}: sql {code}; nami-test {nt}" + ("" if code in (200, 201) else f"; {str(body)[:200]}"))
    return 0 if code in (200, 201) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
