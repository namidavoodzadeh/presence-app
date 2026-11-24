#!/usr/bin/env python3
"""Kenning map on staging: seed namitest's confirmed kennings, two lines and links, through the public API (POST /beliefs, PATCH map, PUT links).
STAGING only (flagged test account). Idempotent: kennings already present by wording are reused. Fictional wording only. Never prints a secret.

    python3 next/scripts/seed_kenning_map_namitest.py
"""
from __future__ import annotations
import json, os, re, sys, urllib.request, urllib.error
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
from supabase_env import load_for_step  # noqa: E402

env = load_for_step("seed_test_contact")
BASE = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
secret = re.search(r"^PRESENCE_PREVIEW_DEVICE_SECRET=(\S+)", (Path.home() / "Library/Application Support/PresenceHome/secrets/staging.env").read_text(), re.M).group(1)

def call(m, p, b=None, t=None):
    h = {"content-type": "application/json", "apikey": env.get("SUPABASE_ANON_KEY", "")}
    if t: h["authorization"] = "Bearer " + t
    if p == "/preview/login": h["x-presence-preview-secret"] = secret
    r = urllib.request.Request(BASE + p, method=m, headers=h, data=json.dumps(b).encode() if b is not None else None)
    try:
        with urllib.request.urlopen(r, timeout=90) as x: return x.status, json.loads(x.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}

KENNINGS = [  # (wording, lines)
    ("I go quiet when plans change.", None),
    ("I say it's fine to keep the peace.", None),
    ("I do my best thinking on long walks.", None),
    ("I want my work to be seen by people I respect.", None),
    ("I remember small things people tell me.", None),
    ("Rest has to be earned.", None),
]
s, j = call("POST", "/preview/login", {"persona": "namitest"})
tok = j.get("access_token")
if not tok: sys.exit(f"login failed {s}")
s, cur = call("GET", "/kennings/map", t=tok)
have = {st.get("words"): st.get("belief_id") for st in cur.get("stations", [])}
ids = []
for words, _ in KENNINGS:
    if words in have: ids.append(have[words]); continue
    s, j = call("POST", "/beliefs", {"statement": words}, tok)
    bid = (j.get("belief") or {}).get("belief_id")
    print("create", s, bool(bid))
    if bid: ids.append(bid)
for a, b, kind, note in ((0, 1, "both_true", None), (2, 3, "both_true", None), (1, 5, "comes_from", None)):
    if len(ids) > max(a, b):
        s, _ = call("PUT", "/kennings/links", {"a": ids[a], "b": ids[b], "kind": kind}, tok); print("link", kind, s)
for i, ls in enumerate((["relationships"], ["relationships", "family"], ["meaning"], ["work"], ["relationships"], ["body"])):
    if i < len(ids): print("lines", call("PATCH", f"/kennings/{ids[i]}/map", {"lines": ls}, tok)[0])
s, m = call("GET", "/kennings/map", t=tok)
print("map:", s, "stations", len(m.get("stations", [])), "links", len(m.get("links", [])), "lines", len((m.get("layout") or {}).get("lines", [])))
