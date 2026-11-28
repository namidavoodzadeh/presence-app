#!/usr/bin/env python3
"""Reads a Supabase client key on stdin; argv[1] is the Supabase project ref the release talks to. Exit 0 only for a key
that may ship inside the app for that project: a well-formed publishable key (sb_publishable_...), or a legacy JWT whose
role is anon, whose ref is that project and whose issuer is Supabase. Anything else (secret, service-role, another
project, malformed) exits 1. The signature cannot be checked offline; release.yml then asks the project itself to accept
the key. Never prints the key."""
import base64, json, re, sys

if len(sys.argv) != 2 or not re.fullmatch(r"[a-z0-9]{20}", sys.argv[1]):
    sys.exit(2)
project = sys.argv[1]
k = sys.stdin.read().strip()
if k.startswith("sb_publishable_"):
    sys.exit(0 if re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]{20,64}", k) else 1)
parts = k.split(".")
try:
    claims = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4))) if len(parts) == 3 else {}
    ok = claims.get("role") == "anon" and claims.get("ref") == project and claims.get("iss") == "supabase"
except Exception:
    ok = False
sys.exit(0 if ok else 1)
