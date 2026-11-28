#!/usr/bin/env python3
"""Reads a Supabase client key on stdin; exit 0 only for a key that may ship inside the app: a publishable key
(sb_publishable_...) or a legacy JWT whose role is anon. Anything else (secret, service-role, unknown) exits 1.
Never prints the key."""
import base64, json, sys

k = sys.stdin.read().strip()
if k.startswith("sb_publishable_"):
    sys.exit(0)
parts = k.split(".")
try:
    ok = len(parts) == 3 and json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4))).get("role") == "anon"
except Exception:
    ok = False
sys.exit(0 if ok else 1)
