#!/usr/bin/env python3
"""Enable native Sign in with Apple for the two approved app audiences. Never prints a credential.

    python3 next/scripts/configure_apple_auth.py
    python3 next/scripts/configure_apple_auth.py --check

This is native ID-token verification only: no web Services ID or rotating OAuth client secret is configured.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_api import call  # noqa: E402
from supabase_env import load  # noqa: E402

CLIENT_IDS = {"com.namidavoodzadeh.presence", "com.namidavoodzadeh.presence.qa"}


def configured(data: dict) -> bool:
    actual = {item.strip() for item in str(data.get("external_apple_client_id") or "").split(",") if item.strip()}
    return data.get("external_apple_enabled") is True and actual == CLIENT_IDS


def main(argv: list[str]) -> int:
    env = load()
    path = f"/projects/{env['SUPABASE_PROJECT_REF']}/config/auth"
    if "--check" not in argv:
        code, body = call(env, "PATCH", path, {
            "external_apple_enabled": True,
            "external_apple_client_id": ",".join(sorted(CLIENT_IDS)),
        })
        if code not in (200, 201):
            print("configure Apple Auth", code, body[:300])
            return 1
    code, body = call(env, "GET", path)
    if code != 200:
        print("check Apple Auth", code, body[:300])
        return 1
    data = json.loads(body)
    ok = configured(data)
    print("Apple Auth", "ready" if ok else "not ready", {
        "enabled": data.get("external_apple_enabled") is True,
        "approved_audiences": ok,
        "native_only": not bool(data.get("external_apple_secret")),
    })
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
