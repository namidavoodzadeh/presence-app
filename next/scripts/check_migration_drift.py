#!/usr/bin/env python3
"""Migration drift guard (E21): coarse spot-check that hosted's schema has every table and
column a committed migration created, so a merged-and-tested migration that was never applied
to hosted fails loudly instead of only surfacing as a user-facing 500 (QA-B3, Ref 6F9Q:
0019_chip_episode_answers.sql's `messages.answer_kind` column was missing on hosted for over a
day because nothing deployed or checked migrations against it; next/scripts/deploy_api.py only
pushes the Edge Function's code).

This is a coarse check, by design: it looks only for `create table ... public.<name>` and
`alter table public.<name> add column ... <col>` statements and confirms the named table/column
exists in hosted's `information_schema`. It does not check types, constraints, indexes, RLS
policies or functions.

    python3 next/scripts/check_migration_drift.py [migrations_dir]

Exit 0: every migration's tables and columns exist on hosted. Exit 1: at least one is missing
(each printed as `<migration file>: missing table <name>` or `missing column <table>.<name>`).
Exit 2: could not reach hosted (treated as a notice by callers, never a silent pass).
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_api import run_sql  # noqa: E402
from supabase_env import load_for_step  # noqa: E402

TABLE_RE = re.compile(r"create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)", re.IGNORECASE)
COLUMN_RE = re.compile(
    r"alter\s+table\s+public\.(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)",
    re.IGNORECASE,
)

# Migrations the owner has deliberately held back from hosted. Expected-absent, not drift.
# Each entry cites its HQ decision. Any other missing migration still fails.
HELD_MIGRATIONS = {
    "0037_errors_client_report.sql": "Nami: hold diagnostics (HQ coo-ask-2026-11-09-1)",
    "0045_account_kind.sql": "0045 held: staging-only canary/reviewer persona column; production personas wait on Nami, HQ coo-ask-2026-11-09-7; no switched-on path reads profiles.account_kind",
}

DEFAULT_MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "supabase" / "migrations"


def expected_objects(migrations_dir: Path) -> dict[str, dict[str, set[str]]]:
    """migration filename -> {"tables": {name, ...}, "columns": {"table.column", ...}}"""
    expected: dict[str, dict[str, set[str]]] = {}
    for path in sorted(migrations_dir.glob("*.sql")):
        text = path.read_text(encoding="utf-8")
        tables = set(TABLE_RE.findall(text))
        columns = {f"{table}.{column}" for table, column in COLUMN_RE.findall(text)}
        if tables or columns:
            expected[path.name] = {"tables": tables, "columns": columns}
    return expected


def hosted_objects() -> tuple[set[str], set[str]] | None:
    """(table names, "table.column" names) present in hosted's public schema, or None on failure."""
    env = load_for_step("drift")
    code, body = run_sql(
        env,
        "select 'table' as kind, table_name as a, '' as b from information_schema.tables "
        "where table_schema = 'public' "
        "union all "
        "select 'column' as kind, table_name as a, column_name as b from information_schema.columns "
        "where table_schema = 'public'",
    )
    if code not in (200, 201):
        print(f"check_migration_drift: could not query hosted schema (HTTP {code}): {body[:300]}", file=sys.stderr)
        return None
    import json

    try:
        rows = json.loads(body)
    except Exception as exc:  # noqa: BLE001
        print(f"check_migration_drift: hosted response was not JSON: {exc}", file=sys.stderr)
        return None
    tables = {row["a"] for row in rows if row["kind"] == "table"}
    columns = {f"{row['a']}.{row['b']}" for row in rows if row["kind"] == "column"}
    return tables, columns


def find_drift(
    expected: dict[str, dict[str, set[str]]], hosted_tables: set[str], hosted_columns: set[str]
) -> list[str]:
    missing: list[str] = []
    for migration, objects in expected.items():
        if migration in HELD_MIGRATIONS:
            continue
        for table in sorted(objects["tables"]):
            if table not in hosted_tables:
                missing.append(f"{migration}: missing table {table}")
        for column in sorted(objects["columns"]):
            if column not in hosted_columns:
                missing.append(f"{migration}: missing column {column}")
    return missing


def target_name() -> str:
    """The project the check read (load_for_step picks staging only under PRESENCE_SUPABASE_ENV=staging)."""
    return "staging" if os.environ.get("PRESENCE_SUPABASE_ENV") == "staging" else "hosted"


def main(argv: list[str]) -> int:
    migrations_dir = Path(argv[0]) if argv else DEFAULT_MIGRATIONS_DIR
    # A wrong or empty directory used to check nothing and exit 0 ("0 migrations checked", 14 Nov): never a pass.
    if not any(migrations_dir.glob("*.sql")):
        print(f"check_migration_drift: no migration files in {migrations_dir}: not checked")
        return 2
    expected = expected_objects(migrations_dir)
    result = hosted_objects()
    if result is None:
        return 2
    hosted_tables, hosted_columns = result
    missing = find_drift(expected, hosted_tables, hosted_columns)
    if missing:
        print(f"check_migration_drift: {len(missing)} object(s) from committed migrations are missing on {target_name()}:")
        for line in missing:
            print(f"  {line}")
        return 1
    for held, why in sorted(HELD_MIGRATIONS.items()):
        if held in expected:
            print(f"check_migration_drift: held, not checked: {held} ({why})")
    print(f"check_migration_drift: {len(expected)} migration(s) with table/column changes all present on {target_name()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
