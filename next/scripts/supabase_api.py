#!/usr/bin/env python3
"""Supabase Management API helper (stdlib only). Never prints a secret.

    python3 next/scripts/supabase_api.py check                      # project, tables, functions, auth health
    python3 next/scripts/supabase_api.py sql  <file.sql | ->          # run SQL (one transaction per call)
    python3 next/scripts/supabase_api.py query "select ..."          # run one statement, print rows as JSON
    python3 next/scripts/supabase_api.py secrets NAME=<env var>      # set a function secret from an env var's value
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_env import load  # noqa: E402

API = "https://api.supabase.com/v1"


def _scrub(text: str, env: dict[str, str]) -> str:
    for v in env.values():
        if v and v in text:
            text = text.replace(v, "<hidden>")
    return text


def call(env: dict[str, str], method: str, path: str, body: dict | list | None = None, base: str | None = None,
         headers: dict[str, str] | None = None, timeout: int = 120) -> tuple[int, str]:
    url = (base or API) + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {env['SUPABASE_ACCESS_TOKEN']}")
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, _scrub(r.read().decode(), env)
    except urllib.error.HTTPError as e:
        return e.code, _scrub(e.read().decode(), env)
    except Exception as e:  # noqa: BLE001
        return 0, _scrub(f"{type(e).__name__}: {e}", env)


def run_sql(env: dict[str, str], sql: str) -> tuple[int, str]:
    return call(env, "POST", f"/projects/{env['SUPABASE_PROJECT_REF']}/database/query", {"query": sql})


def main(argv: list[str]) -> int:
    env = load()
    ref = env["SUPABASE_PROJECT_REF"]
    cmd = argv[0] if argv else "check"
    if cmd == "check":
        code, body = call(env, "GET", f"/projects/{ref}")
        info = {}
        try:
            d = json.loads(body)
            info = {k: d.get(k) for k in ("name", "region", "status")}
        except Exception:  # noqa: BLE001
            info = {"body": body[:200]}
        print("project", code, info)
        code, body = run_sql(env, "select tablename from pg_tables where schemaname='public' order by 1")
        print("tables", code, body[:1500])
        code, body = call(env, "GET", f"/projects/{ref}/functions")
        try:
            print("functions", code, [f.get("slug") for f in json.loads(body)])
        except Exception:  # noqa: BLE001
            print("functions", code, body[:300])
        code, body = call(env, "GET", "/auth/v1/health", base=env["SUPABASE_URL"], headers={"apikey": env["SUPABASE_ANON_KEY"]})
        print("auth health", code, body[:200])
        return 0
    if cmd == "sql":
        src = sys.stdin.read() if argv[1] == "-" else Path(argv[1]).read_text()
        code, body = run_sql(env, src)
        print(code, body[:2000])
        return 0 if code == 201 or code == 200 else 1
    if cmd == "query":
        code, body = run_sql(env, argv[1])
        print(code, body[:4000])
        return 0 if code in (200, 201) else 1
    if cmd == "secrets":
        pairs = []
        for spec in argv[1:]:
            name, var = spec.split("=", 1)
            value = os.environ.get(var)
            if not value:
                print(f"env var {var} is empty; nothing set")
                return 1
            pairs.append({"name": name, "value": value})
        code, body = call(env, "POST", f"/projects/{ref}/secrets", pairs)
        print("secrets", code, _scrub(body, {p["name"]: p["value"] for p in pairs})[:300])
        return 0 if code in (200, 201) else 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
