#!/usr/bin/env python3
"""Rehearse one migration on STAGING only: state, rollback (exactly as written in the file's
'-- Rollback:' comment), drift check on staging, re-apply, drift check, with timings.
Never reads production keys. Never prints a value.

    python3 next/scripts/rehearse_migration.py 0059_draft_saved_insight.sql
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_migration_drift import COLUMN_RE, TABLE_RE  # noqa: E402
from staging_setup import STAGING  # noqa: E402
from supabase_api import run_sql  # noqa: E402
from supabase_env import load  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"


def rollback_sql(text: str) -> str:
    """The SQL in the '-- Rollback:' comment and its '--' continuation lines."""
    lines = text.splitlines()
    out: list[str] = []
    for i, line in enumerate(lines):
        if line.startswith("-- Rollback:"):
            out.append(line[len("-- Rollback:"):].strip())
            for nxt in lines[i + 1:]:
                if not nxt.startswith("--"):
                    break
                out.append(nxt[2:].strip())
            break
    return " ".join(p for p in out if p)


def present(env, text: str) -> dict[str, bool]:
    code, body = run_sql(env, "select table_name a, column_name b from information_schema.columns where table_schema='public'")
    if code not in (200, 201):
        raise SystemExit(f"schema query failed: {code}")
    cols = {f"{r['a']}.{r['b']}" for r in json.loads(body)}
    return {f"{t}.{c}": f"{t}.{c}" in cols for t, c in COLUMN_RE.findall(text)}


def timed(label: str, fn):
    t = time.monotonic()
    r = fn()
    print(f"{label}: {time.monotonic() - t:.2f} s")
    return r


def main(name: str) -> int:
    env = load(STAGING)
    text = (MIGRATIONS / name).read_text()
    rb = rollback_sql(text)
    if not rb:
        print("no Rollback line in the file"); return 1
    print("rollback sql:", rb)
    print("before:", present(env, text))
    code, _ = timed("rollback", lambda: run_sql(env, rb + f"\n;delete from public._staging_migrations where name = '{name}';"))
    if code not in (200, 201):
        print("rollback failed", code); return 1
    after_rb = present(env, text)
    print("after rollback:", after_rb)
    ok = not any(after_rb.values())
    code, _ = timed("re-apply", lambda: run_sql(env, text + f"\n;insert into public._staging_migrations(name) values ('{name}') on conflict do nothing;"))
    if code not in (200, 201):
        print("re-apply failed", code); return 1
    after = present(env, text)
    print("after re-apply:", after)
    ok = ok and all(after.values())
    print("REHEARSAL", "OK" if ok else "RED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
