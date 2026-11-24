#!/usr/bin/env python3
"""Reset the hosted PRESENCE_PREVIEW_DEVICE_SECRET to a fresh value that matches the Mac loader. Never prints a value.

    python3 next/scripts/rotate_preview_secret.py --repo-root <checkout with ops/secrets> [--persona sam] [--record <deploy-record.jsonl>]

Scope is this one function secret and nothing else on hosted (set_function_secrets.py posts every secret, so it is not used here).
Order: generate -> write the Mac loader files (ops/secrets/qa-preview.env and PresenceHome/secrets/preview-device.env, 0600,
atomic, old copy kept as .prev) -> POST that one secret to the hosted project -> POST /preview/login for the persona from the
loader files and require 200 -> append a record line (digests of 12 hex only). The previous hosted value cannot be read back
(the Management API lists names and digests only), so the record carries the previous digest; rollback = set a known value
with this script's --value-from <file> (a protected file) and the same probe.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets as secret_generator
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_api import call  # noqa: E402
from supabase_env import load_production, load_public_production  # noqa: E402

NAME = "PRESENCE_PREVIEW_DEVICE_SECRET"


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def write_secret_file(path: Path, value: str) -> None:
    """Atomic 0600 write of NAME=value; the old file, if any, is kept as <name>.prev (also 0600)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        prev = path.with_name(path.name + ".prev")
        fd = os.open(prev, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as out:
            out.write(path.read_bytes())
        os.chmod(prev, 0o600)
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as out:
        out.write(f"{NAME}={value}\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def read_secret_file(path: Path) -> str:
    for line in path.read_text().splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:]
        if line.startswith(NAME + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"{path.name}: missing {NAME}")


def login_status(base: str, anon: str, persona: str, value: str) -> int:
    req = urllib.request.Request(
        base.rstrip("/") + "/functions/v1/api/preview/login", method="POST",
        data=json.dumps({"persona": persona}).encode(),
        headers={"content-type": "application/json", "apikey": anon, "x-presence-preview-secret": value})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            r.read()
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:  # noqa: BLE001
        return 0


def hosted_digest(env: dict[str, str]) -> str | None:
    code, text = call(env, "GET", f"/projects/{env['SUPABASE_PROJECT_REF']}/secrets")
    if code != 200:
        return None
    try:
        for s in json.loads(text):
            if s.get("name") == NAME:
                return str(s.get("value") or s.get("updated_at") or "present")[:64]
    except Exception:  # noqa: BLE001
        return None
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", required=True)
    ap.add_argument("--persona", default="sam")
    ap.add_argument("--record")
    ap.add_argument("--value-from", help="protected file holding NAME=value to set instead of a fresh one (rollback)")
    a = ap.parse_args(argv)
    root = Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome"))
    qa_file = Path(a.repo_root) / "ops/secrets/qa-preview.env"
    loader_file = root / "secrets/preview-device.env"

    env = load_production("deploy")
    pub = load_public_production()
    before_local = digest(read_secret_file(qa_file)) if qa_file.exists() else None
    before_hosted = hosted_digest(env)
    value = read_secret_file(Path(a.value_from)) if a.value_from else secret_generator.token_urlsafe(32)

    write_secret_file(qa_file, value)
    write_secret_file(loader_file, value)
    code, text = call(env, "POST", f"/projects/{env['SUPABASE_PROJECT_REF']}/secrets", [{"name": NAME, "value": value}])
    print("set hosted secret", NAME, "HTTP", code, text.replace(value, "<hidden>")[:120])
    if code not in (200, 201):
        print("RED: hosted secret not set; local files already carry the new value, hosted unchanged")
        return 1
    status = login_status(pub["SUPABASE_URL"], pub["SUPABASE_ANON_KEY"], a.persona, read_secret_file(qa_file))
    old_status = login_status(pub["SUPABASE_URL"], pub["SUPABASE_ANON_KEY"], a.persona, read_secret_file(qa_file.with_name("qa-preview.env.prev"))) \
        if qa_file.with_name("qa-preview.env.prev").exists() else None
    print(f"hosted preview login {a.persona}: new value HTTP {status}; previous local value HTTP {old_status}")
    if a.record:
        line = {"kind": "secret_rotation", "target": "hosted", "secret": NAME, "at": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime()),
                "previous_local_digest": before_local, "previous_hosted_marker": before_hosted, "new_digest": digest(value),
                "login_persona": a.persona, "login_status": status, "value_printed": False,
                "reason": "CEO 05:20Z 16 Nov, Nami's named yes: reset hosted preview-login secret to match the Mac loader"}
        with open(a.record, "a") as out:
            out.write(json.dumps(line) + "\n")
    return 0 if status == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())
