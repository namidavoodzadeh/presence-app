#!/usr/bin/env python3
"""sre-01: set up the presence-staging project. Never prints a secret.

    python3 next/scripts/staging_setup.py keys       # add SUPABASE_URL + anon + service keys to staging.env
    python3 next/scripts/staging_setup.py migrate    # apply every migration not yet applied (records in public._staging_migrations)
    python3 next/scripts/staging_setup.py status     # project status, applied migrations, tables without RLS
Reads ~/Library/Application Support/PresenceHome/secrets/staging.env (never supabase.env, so production is untouched).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_api import call, run_sql  # noqa: E402

STAGING = Path.home() / "Library/Application Support/PresenceHome/secrets/staging.env"


def load(path: Path) -> dict[str, str]:
    env = {}
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"\'')
    return env


MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"


def keys() -> int:
    env = load(STAGING)
    ref = env["SUPABASE_PROJECT_REF"]
    code, body = call(env, "GET", f"/projects/{ref}/api-keys?reveal=true")
    if code != 200:
        print("api-keys", code, body[:200]); return 1
    found = {}
    for k in json.loads(body):
        name = k.get("name") or k.get("id")
        if name in ("anon", "service_role"):
            found[name] = k["api_key"]
    if len(found) != 2:
        print("missing legacy anon/service_role keys; got", sorted(found)); return 1
    have = {l.split("=", 1)[0] for l in STAGING.read_text().splitlines() if "=" in l}
    add = {"SUPABASE_URL": f"https://{ref}.supabase.co", "SUPABASE_ANON_KEY": found["anon"],
           "SUPABASE_SERVICE_ROLE_KEY": found["service_role"]}
    with STAGING.open("a") as f:
        for k, v in add.items():
            if k not in have:
                f.write(f"{k}={v}\n")
    print("staging.env now has", sorted(have | set(add)))
    return 0


def migrate() -> int:
    env = load(STAGING)
    code, body = run_sql(env, "create table if not exists public._staging_migrations(name text primary key, applied_at timestamptz default now()); alter table public._staging_migrations enable row level security;")
    if code not in (200, 201):
        print("bootstrap", code, body[:300]); return 1
    code, body = run_sql(env, "select name from public._staging_migrations")
    done = {r["name"] for r in json.loads(body)}
    for p in sorted(MIGRATIONS.glob("*.sql")):
        if p.name in done:
            continue
        sql = p.read_text() + f"\n;insert into public._staging_migrations(name) values ('{p.name}');"
        code, body = run_sql(env, sql)
        print(p.name, code, "" if code in (200, 201) else body[:400])
        if code not in (200, 201):
            return 1
    return 0


def status() -> int:
    env = load(STAGING)
    code, body = call(env, "GET", f"/projects/{env['SUPABASE_PROJECT_REF']}")
    print("project", code, {k: json.loads(body).get(k) for k in ("name", "region", "status")} if code == 200 else body[:200])
    code, body = run_sql(env, "select count(*) n from public._staging_migrations")
    print("applied", code, body[:100])
    code, body = run_sql(env, "select tablename from pg_tables where schemaname='public' and not rowsecurity")
    print("no-RLS tables", code, body[:400])
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    raise SystemExit({"keys": keys, "migrate": migrate, "status": status}[cmd]())
