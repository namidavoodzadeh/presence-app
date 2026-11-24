#!/usr/bin/env python3
"""Deploy the `api` Edge Function through the Management API (no Supabase CLI, no Docker). Never prints a secret.

    python3 next/scripts/deploy_api.py            # upload next/api + next/engine and deploy as function slug `api`
    python3 next/scripts/deploy_api.py --list     # list the project's functions
    PRESENCE_SUPABASE_ENV=staging python3 next/scripts/deploy_api.py --rollback   # staging only: put an earlier, already-running tree back; no gold-set run

The upload is the file tree the function imports, with repo-relative paths; the entrypoint is next/api/hosted.ts, which
serves the same handler the Mac fallback runs on 8820. verify_jwt is off: the handler checks the bearer itself (and
/preview/login, /health run without one).
"""
from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy_gate  # noqa: E402
from supabase_api import call  # noqa: E402
from supabase_env import load_for_step  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
SLUG = "api"
ENTRYPOINT = "next/api/hosted.ts"
INCLUDE = ["next/api", "next/engine"]
EXCLUDE_DIRS = {"harness", "prompts", "sim"}
EXCLUDE_FILES = {"check.ts", "check_ledger.ts", "check_talk.ts", "check_map.ts", "check_bridge.ts", "check_bridge_engine.ts", "check_mirror.ts", "check_data.ts", "check_bridge_journey.ts", "check_mirror_owner.ts",
                 "check_latency.ts", "check_voice_stream_latency.ts", "check_apple_accounts.ts", "scrub_mirror_trace.ts", "smoke_hosted.ts", "smoke_bridge_hosted.ts", "smoke_mirror_hosted.ts"}


def files() -> list[Path]:
    out: list[Path] = []
    for base in INCLUDE:
        # *.ts plus JSON modules under _shared/ that code imports with { type: "json" } (K-0007: the safety backstop).
        found = list((REPO / base).rglob("*.ts")) + list((REPO / base).rglob("_shared/**/*.json"))
        for p in sorted(found):
            rel = p.relative_to(REPO)
            if any(part in EXCLUDE_DIRS for part in rel.parts) or rel.name in EXCLUDE_FILES:
                continue
            out.append(p)
    return out


def release_file() -> str:
    """next/api/lib/release_id.ts with this checkout's git sha and date, so every ledger row names the code that made it."""
    import subprocess
    sha = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip() or "unknown"
    day = subprocess.run(["git", "-C", str(REPO), "show", "-s", "--format=%cs", "HEAD"], capture_output=True, text=True).stdout.strip()
    return f'export const RELEASE_ID = "{sha}@{day}";\n'


def multipart(parts: list[tuple[str, str | None, bytes, str]]) -> tuple[bytes, str]:
    boundary = "----presence" + uuid.uuid4().hex
    body = bytearray()
    for name, filename, data, ctype in parts:
        body += f"--{boundary}\r\n".encode()
        disp = f'form-data; name="{name}"' + (f'; filename="{filename}"' if filename else "")
        body += f"Content-Disposition: {disp}\r\nContent-Type: {ctype}\r\n\r\n".encode()
        body += data + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def main(argv: list[str]) -> int:
    env = load_for_step("deploy")
    ref = env["SUPABASE_PROJECT_REF"]
    if "--list" in argv:
        code, text = call(env, "GET", f"/projects/{ref}/functions")
        try:
            print(code, [(f.get("slug"), f.get("status"), f.get("version"), f.get("entrypoint_path")) for f in json.loads(text)])
        except Exception:  # noqa: BLE001
            print(code, text[:500])
        return 0
    staging = os.environ.get("PRESENCE_SUPABASE_ENV") == "staging"
    if not staging and "--production" not in argv:
        # Incident Q-ENG-HOSTED-V75: the default target was the live server. It now needs an explicit flag.
        print("refusing: no PRESENCE_SUPABASE_ENV=staging and no --production flag; hosted deploys need an explicit yes", file=sys.stderr)
        return 2
    rollback = "--rollback" in argv
    if rollback and not staging:
        print("refusing: --rollback is for staging only; the live server always goes through the gate", file=sys.stderr)
        return 2
    if not staging:
        # Live server: a prompt or model-setting change needs a green staging gold-set score first.
        if deploy_gate.main(["require"]) != 0:
            return 3
    metadata = {"entrypoint_path": ENTRYPOINT, "name": SLUG, "verify_jwt": False}
    parts: list[tuple[str, str | None, bytes, str]] = [("metadata", None, json.dumps(metadata).encode(), "application/json")]
    paths = files()
    for p in paths:
        data = p.read_bytes()
        if p.name == "release_id.ts":
            data = release_file().encode()
        parts.append(("file", str(p.relative_to(REPO)), data, "application/typescript"))
    body, ctype = multipart(parts)
    print(f"uploading {len(paths)} files ({len(body) // 1024} KB), entrypoint {ENTRYPOINT}")
    import urllib.error
    import urllib.request
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{ref}/functions/deploy?slug={SLUG}", data=body, method="POST")
    req.add_header("Authorization", f"Bearer {env['SUPABASE_ACCESS_TOKEN']}")
    req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            code, text = r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        code, text = e.code, e.read().decode()
    for v in env.values():
        text = text.replace(v, "<hidden>")
    try:
        d = json.loads(text)
        print("deploy", code, {k: d.get(k) for k in ("id", "slug", "status", "version", "entrypoint_path", "verify_jwt", "updated_at")})
    except Exception:  # noqa: BLE001
        print("deploy", code, text[:1500])
    if code not in (200, 201):
        return 1
    sha = deploy_gate.head_sha()
    target = "staging" if staging else "hosted"
    touched = deploy_gate.touched_now(target)
    rec = {"kind": "deploy", "target": target, "sha": sha, "touched_prompt": touched, "ts": int(__import__("time").time())}
    if rollback:
        # Putting back a tree that already ran on staging is not a new wording, so it is recorded as a rollback and spends nothing.
        # A live-server deploy still needs a recorded score at its own sha (deploy_gate require), so this opens no way around it.
        rec["rollback"] = True
    deploy_gate.append_record(rec)
    if rollback:
        print("rollback recorded; no gold set run")
        return 0
    if staging and touched:
        print("deploy touches a prompt or model setting; running the gold set on staging:", touched[:5])
        return deploy_gate.run_staging()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
