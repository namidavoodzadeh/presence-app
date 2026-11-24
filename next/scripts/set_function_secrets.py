#!/usr/bin/env python3
"""Set the `api` Edge Function's secrets from the owner's protected files, never printing a value.

    python3 next/scripts/set_function_secrets.py

Reads ANTHROPIC_API_KEY and ANTHROPIC_WORKSPACE_ID from ~/Library/Application Support/PresenceHome/.env.anthropic.local and
PRESENCE_PREVIEW_PASSWORD from .../secrets/presence-preview.env, and posts them to the project's function secrets through the
Management API (the SUPABASE_* ones are injected by the platform). The COO-approved phase-1 live-voice flag is set explicitly;
removing that one name disables the SSE path without changing the ordinary Talk route. Prints only names and HTTP status.
"""
from __future__ import annotations

import json
import os
import secrets as secret_generator
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_api import call  # noqa: E402
from supabase_env import load_for_step, load_apns  # noqa: E402

ROOT = Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome"))


def read_values(path: Path, keys: tuple[str, ...]) -> dict[str, str]:
    values: dict[str, str] = {}
    pending = None
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" in line and line.split("=", 1)[0].strip().isupper():
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if v:
                values[k] = v
                pending = None
            else:
                pending = k
            continue
        if pending:
            values[pending] = line.strip('"').strip("'")
            pending = None
    missing = [k for k in keys if not values.get(k)]
    if missing:
        raise SystemExit(f"{path.name}: missing {', '.join(missing)}")
    return {k: values[k] for k in keys}


def persistent_drain_secret() -> str:
    """Create the protected drain credential once; later secret refreshes keep the same value."""
    path = ROOT / "secrets/push-drain.env"
    if path.exists():
        return read_values(path, ("PUSH_DRAIN_SECRET",))["PUSH_DRAIN_SECRET"]
    value = secret_generator.token_urlsafe(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as out:
        out.write(f"PUSH_DRAIN_SECRET={value}\n")
    return value


def persistent_tester_token() -> str:
    """Create the protected tester-report credential once (POST /feedback); later refreshes keep the same value."""
    path = ROOT / "secrets/tester-token.env"
    if path.exists():
        return read_values(path, ("PRESENCE_TESTER_TOKEN",))["PRESENCE_TESTER_TOKEN"]
    value = secret_generator.token_urlsafe(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as out:
        out.write(f"PRESENCE_TESTER_TOKEN={value}\n")
    return value


def persistent_preview_device_secret() -> str:
    """Create the hosted-only preview/login device secret once (never in the app bundle); later refreshes keep the same value.

    Q-ENG-SETSECRETS-1: against staging this reads staging.env's own value and never falls back to the hosted file (a staging run
    once overwrote staging's secret with the hosted one). A staging.env without the name stops the run."""
    if os.environ.get("PRESENCE_SUPABASE_ENV") == "staging":
        return read_values(ROOT / "secrets/staging.env", ("PRESENCE_PREVIEW_DEVICE_SECRET",))["PRESENCE_PREVIEW_DEVICE_SECRET"]
    path = ROOT / "secrets/preview-device.env"
    if path.exists():
        return read_values(path, ("PRESENCE_PREVIEW_DEVICE_SECRET",))["PRESENCE_PREVIEW_DEVICE_SECRET"]
    value = secret_generator.token_urlsafe(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as out:
        out.write(f"PRESENCE_PREVIEW_DEVICE_SECRET={value}\n")
    return value


def main() -> int:
    env = load_for_step("deploy")
    secrets = {}
    secrets.update(read_values(ROOT / ".env.anthropic.local", ("ANTHROPIC_API_KEY", "ANTHROPIC_WORKSPACE_ID")))
    secrets.update(read_values(ROOT / "secrets/presence-preview.env", ("PRESENCE_PREVIEW_PASSWORD",)))
    secrets.update(load_apns(ROOT))
    secrets["PUSH_DRAIN_SECRET"] = persistent_drain_secret()
    secrets["PRESENCE_TESTER_TOKEN"] = persistent_tester_token()
    secrets["PRESENCE_PREVIEW_DEVICE_SECRET"] = persistent_preview_device_secret()
    secrets["PRESENCE_LIVE_VOICE_PHASE1"] = "true"
    body = [{"name": k, "value": v} for k, v in secrets.items()]
    code, text = call(env, "POST", f"/projects/{env['SUPABASE_PROJECT_REF']}/secrets", body)
    for v in secrets.values():
        text = text.replace(v, "<hidden>")
    print("secrets", code, sorted(secrets), text[:200])
    code2, text2 = call(env, "GET", f"/projects/{env['SUPABASE_PROJECT_REF']}/secrets")
    try:
        names = sorted(s.get("name") for s in json.loads(text2))
    except Exception:  # noqa: BLE001
        names = [text2[:200]]
    print("function secrets now:", names)
    return 0 if code in (200, 201) else 1


if __name__ == "__main__":
    raise SystemExit(main())
