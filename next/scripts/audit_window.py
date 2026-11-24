#!/usr/bin/env python3
"""Read-only: request-level facts for a time window on the hosted project. Ids, codes, timestamps, counts; never message text.
    python3 next/scripts/audit_window.py --from 2026-11-10T06:00:00Z --to 2026-11-10T06:20:00Z [--persona namitest]
"""
from __future__ import annotations
import json, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from supabase_env import load_production  # noqa: E402
from supabase_api import run_sql  # noqa: E402

def rows(env, sql):
    code, body = run_sql(env, sql)
    if code not in (200, 201): raise SystemExit(f"query failed {code}: {body[:300]}")
    return json.loads(body)

def main(a):
    f = a[a.index("--from") + 1]; t = a[a.index("--to") + 1]
    persona = a[a.index("--persona") + 1] if "--persona" in a else None
    env = load_production("audit")
    w = f"created_at >= '{f}'::timestamptz and created_at < '{t}'::timestamptz"
    prof = f"(select id from profiles where persona = '{persona}')" if persona else None
    out = {}
    out["errors"] = rows(env, f"select ref, where_, code, source, created_at, (select persona from profiles p where p.id = e.person) as persona from errors e where {w} order by created_at")
    out["engine_calls"] = rows(env, f"select person, purpose, status, created_at from engine_calls where {w} order by created_at" if False else f"select (select persona from profiles p where p.id = c.person) as persona, purpose, created_at from engine_calls c where {w} order by created_at")
    out["conversations"] = rows(env, f"select (select persona from profiles p where p.id = c.owner) as persona, id, status, source, mode, started_at, finished_at from conversations c where started_at >= '{f}'::timestamptz - interval '1 hour' and started_at < '{t}'::timestamptz order by started_at")
    out["messages"] = rows(env, f"select conversation_id, role, created_at, length(text) as len from messages where {w} order by created_at")
    print(json.dumps(out, indent=1, default=str))
    return 0

if __name__ == "__main__": raise SystemExit(main(sys.argv))
