#!/usr/bin/env python3
"""Load the owner's Supabase secrets without ever printing a value.

sre-08: load() reads staging.env only. The production file (supabase.env) is read by load_production("deploy" or
"drift") and nothing else; the health probe gets URL + anon key through load_public_production().

The file at ~/Library/Application Support/PresenceHome/secrets/supabase.env was written with each key on one
line (`KEY=`) and its value on the next, so `set -a; . file; set +a` executes the values as commands and echoes
them to stderr (seen once, 2026-10-27 12:45 Tehran). This loader accepts both that layout and plain KEY=value.

Usage from a shell script (the values go into the environment of one command, never to a terminal):

    eval "$(python3 next/scripts/supabase_env.py --export)"; some-command; unset SUPABASE_ACCESS_TOKEN ...

or from Python: `from supabase_env import load; env = load()`.

`--check` prints only which keys are present and their lengths.
"""
from __future__ import annotations

import os
import shlex
import sys
from pathlib import Path

KEYS = ("SUPABASE_URL", "SUPABASE_PROJECT_REF", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ACCESS_TOKEN")


PRODUCTION_STEPS = ("deploy", "drift", "seed_test_contact", "pull_feedback", "audit", "hosted_test_pair", "seed_preview_pair")  # seed_preview_pair: CEO 17 Nov 23:25 PT (K-0011, Nami's ship-tonight yes): seed_preview.py --qa-pair --production, preview personas Sam and Jo only  # hosted_test_pair: COO 19:25Z 17 Nov, two fictional test accounts for QA B403/B404 hosted probes, removed after; audit: COO 10 Nov, read-only ids/counts/codes, no user text. sre-08: the only steps that may read the production keys (seed_test_contact: CEO 9 Nov 16:45 PT, the one flagged test account; pull_feedback: COO 10 Nov, testers' reports live in production)
LANE_SCRUB = ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD")


def _secrets_dir() -> Path:
    root = Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome"))
    return root / "secrets"


def default_path() -> Path:
    """sre-08: every default load is staging. Production comes only through load_production()."""
    return _secrets_dir() / "staging.env"


def production_path() -> Path:
    return _secrets_dir() / "supabase.env"


def load_production(step: str) -> dict[str, str]:
    """The one loader for the production keys, for the hosted-deploy and migration-drift steps only.
    Errors name keys and the step, never a value."""
    if step not in PRODUCTION_STEPS:
        raise SystemExit(f"production keys are loaded only by the {' and '.join(PRODUCTION_STEPS)} steps, not '{step}'")
    return load(production_path())


def load_for_step(step: str) -> dict[str, str]:
    """Deploy and drift steps: staging when PRESENCE_SUPABASE_ENV=staging (the default for nothing else), else production."""
    if os.environ.get("PRESENCE_SUPABASE_ENV") == "staging":
        return load()
    return load_production(step)


def load_preview_device_secret(hosted: bool = False) -> str:
    """Return the requested environment's preview-device secret without printing it.

    Hosted callers are limited to the test-account preview login path; production
    Supabase credentials still go through ``load_production`` and its step allowlist.
    """
    path = _secrets_dir() / "preview-device.env" if hosted else default_path()
    value = _read_values(path).get("PRESENCE_PREVIEW_DEVICE_SECRET", "")
    if not value:
        raise SystemExit(f"{path.name}: missing PRESENCE_PREVIEW_DEVICE_SECRET")
    return value


def load_public_production() -> dict[str, str]:
    """URL and anon key only (both public), for the health probe. Never a service or access key."""
    try:
        values = _read_values(production_path())
    except OSError:
        return {}
    return {k: values[k] for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY") if values.get(k)}


def scrub_lane_env(env: dict[str, str]) -> dict[str, str]:
    """A lane worker's environment never carries a Supabase service, access or database credential."""
    return {k: v for k, v in env.items() if k not in LANE_SCRUB}


def _read_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    pending: str | None = None
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        if "=" in line and line.split("=", 1)[0].strip().replace("_", "").isalnum() and line.split("=", 1)[0].strip().isupper():
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if value:
                values[key] = value
                pending = None
            else:
                pending = key
            continue
        if pending:
            values[pending] = line.strip('"').strip("'")
            pending = None
    return values


def load(path: Path | None = None) -> dict[str, str]:
    """Rotation (outputs/engine/ROTATION.md): a PRESENCE_SERVICE_KEY line (an sb_secret_ key) takes the place of the legacy service-role
    key under the same name, so every caller keeps reading env["SUPABASE_SERVICE_ROLE_KEY"]. Delete that line to go back to the legacy key."""
    values = _read_values(path or default_path())
    if values.get("PRESENCE_SERVICE_KEY"):
        values["SUPABASE_SERVICE_ROLE_KEY"] = values["PRESENCE_SERVICE_KEY"]
    missing = [k for k in KEYS if not values.get(k)]
    if missing:
        raise SystemExit(f"Supabase env file: missing {', '.join(missing)}")
    return {k: values[k] for k in KEYS}


def service_headers(env: dict[str, str]) -> dict[str, str]:
    """Headers for a server-side call with the service key. An sb_secret_ key is not a JWT: it goes in `apikey` only; the legacy JWT
    also goes in Authorization, as before."""
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def load_apns(root: Path | None = None) -> dict[str, str]:
    """Read the APNs key id and matching private key without printing either."""
    root = root or Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome"))
    secrets = root / "secrets"
    values: dict[str, str] = {}
    pending: str | None = None
    for raw in (secrets / "asc.env").read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" in line:
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if value:
                values[key] = value
                pending = None
            else:
                pending = key
        elif pending:
            values[pending] = line.strip('"').strip("'")
            pending = None
    key_id = values.get("APNS_KEY_ID", "")
    if not key_id:
        raise SystemExit("asc.env: missing APNS_KEY_ID")
    key_path = secrets / f"AuthKey_{key_id}.p8"
    if not key_path.is_file():
        raise SystemExit("APNs private key file matching APNS_KEY_ID is missing")
    private_key = key_path.read_text()
    if "BEGIN PRIVATE KEY" not in private_key:
        raise SystemExit("APNs private key file is invalid")
    return {"APNS_KEY_ID": key_id, "APNS_PRIVATE_KEY": private_key, "APNS_TEAM_ID": "UK39PYVJ96"}


def main(argv: list[str]) -> int:
    env = load()
    if "--export" in argv:
        for k, v in env.items():
            sys.stdout.write(f"export {k}={shlex.quote(v)}\n")
        return 0
    # --check (default): names and lengths only.
    for k, v in env.items():
        print(f"{k}: {len(v)} chars")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
