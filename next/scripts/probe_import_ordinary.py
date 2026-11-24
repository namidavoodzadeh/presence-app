#!/usr/bin/env python3
"""Probe QA-B401's ordinary import boundary with a fictional test account.

The route must never answer HTTP 500 to this ordinary idiom. Staging is the
default; ``--hosted`` is restricted to the named preview test account.

    python3 next/scripts/probe_import_ordinary.py [--hosted]
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
HOSTED = "--hosted" in sys.argv
if not HOSTED:
    os.environ["PRESENCE_SUPABASE_ENV"] = "staging"

from supabase_env import load_for_step, load_preview_device_secret  # noqa: E402

env = load_for_step("seed_test_contact")
base = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
secret = load_preview_device_secret(hosted=HOSTED)


def call(method: str, path: str, body: dict | None = None, token: str = "") -> tuple[int, dict]:
    headers = {"content-type": "application/json", "accept": "application/json", "apikey": env["SUPABASE_ANON_KEY"]}
    if token:
        headers["authorization"] = "Bearer " + token
    if path == "/preview/login":
        headers["x-presence-preview-secret"] = secret
    request = urllib.request.Request(base + path, method=method, headers=headers,
                                     data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read() or b"{}")
        except Exception:
            return error.code, {}


status, login = call("POST", "/preview/login", {"persona": "namitest"})
token = str(login.get("access_token", ""))
if status != 200 or not token:
    print(f"FAIL test-account login (HTTP {status})")
    raise SystemExit(1)

# QA-B401's own ordinary control, fictional and without personal data.
ordinary = "I could murder a curry right now."
payload = {
    "text": "Here is what I noticed about this person over our conversations. " + ordinary
            + " They also like long walks and tea, and they usually text back within the hour.",
    "source": "other",
    "imported_at": "2026-11-21T00:00:00Z",
    "provider_disclosure": {"provider": "anthropic", "disclosed_at": "2026-11-21T00:00:00Z"},
}
status, reply = call("POST", "/imports/ai", payload, token)
state = str(reply.get("state") or reply.get("error") or "none")
ok = status != 500
print(f"{'PASS' if ok else 'FAIL'} {'hosted' if HOSTED else 'staging'} ordinary import avoids 500 (HTTP {status} state={state})")
raise SystemExit(0 if ok else 1)
