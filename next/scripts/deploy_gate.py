#!/usr/bin/env python3
"""Wording gate for deploys that touch a prompt or a model setting (CEO 17:05 PT 12 Nov). Never prints a secret.

A deploy that changes a prompt or model setting runs the gold set on STAGING and records the score in the deploy record
(outputs/engine/deploy-record.jsonl, one JSON object per line). A score below the last recorded score for the same suite
stops the next deploy to the live server until someone explains it (`deploy_gate.py explain "<why>"`).

    python3 next/scripts/deploy_gate.py touched [--since SHA]   # does HEAD touch a prompt or model setting? exit 0 yes, 1 no
    python3 next/scripts/deploy_gate.py run-staging              # eval-open, gold set on staging, eval-close, record (deploy_api.py calls this)
    python3 next/scripts/deploy_gate.py require                  # live-server deploy check: exit 3 when the gate stops it
    python3 next/scripts/deploy_gate.py explain "why"            # record an explanation for the blocked score at HEAD

Suites: `bridge` (next/evals/bridge_golden.json, scored by eval_bridge_golden.ts). `talk` (next/evals/talk_gold.json, eval_talk_gold.py) replays fictional told episodes; without that file it is recorded as skipped, never as a pass. Spend stays inside staging's own cap (Bridge --cap 140, Talk --cap-cents 100).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CAP_CENTS = 100
# The Bridge golden run reserves 40¢ before each case (eval_bridge_golden.ts), so the cap must hold the whole set's real spend
# plus one reservation. Since the semantic safety check (QA-B336) a case costs about 3.9¢ (62¢ for 16 at 72cb372a; 55¢ for 20
# before it), so 20 cases are about 78¢ and the last one needs 78 + 40 = 118¢ of room; 100¢ left g17-g20 NOT RUN (Q-ENG-G20-THREAT).
# Staging's eval ledger keeps its own 300¢ day cap underneath this.
BRIDGE_CAP_CENTS = 140

# Files whose change can alter what a model says or which model says it.
PROMPT_PATTERNS = [
    r"^next/engine/[^/]+/prompts/",
    r"^next/engine/prompt_text\.ts$",
    r"^next/engine/safety_semantic\.ts$",  # the semantic safety check's inline prompt and model (QA-B336); it decides Talk and Bridge stops
    r"^next/engine/model/client\.ts$",
    r"^next/engine/bridge/insight_copy\.json$",
    r"^next/api/lib/talk_opener\.ts$",
    r"^next/scripts/set_function_secrets\.py$",
]
SUITES = ("bridge", "talk")


def operations_home() -> Path:
    """The shared Presence checkout, not an individual lane worktree."""
    override = os.environ.get("PRESENCE_OPERATIONS_HOME")
    return Path(override) if override else REPO.parents[1]


def record_path() -> Path:
    override = os.environ.get("PRESENCE_DEPLOY_RECORD")
    return Path(override) if override else operations_home() / "outputs" / "engine" / "deploy-record.jsonl"


def eval_report_path(suite: str, tag: str, day: str | None = None) -> Path:
    """The gold evaluators write their evidence in the shared operations home."""
    prefix = "bridge-golden" if suite == "bridge" else "talk-gold"
    day = day or time.strftime("%Y-%m-%d", time.gmtime())
    return operations_home() / "outputs" / "engine" / "evals" / f"{prefix}-{day}-{tag}.md"


def is_prompt_file(path: str) -> bool:
    return any(re.search(p, path) for p in PROMPT_PATTERNS)


def touches_prompt(changed: list[str]) -> list[str]:
    return [p for p in changed if is_prompt_file(p)]


def read_records(path: Path | None = None) -> list[dict]:
    path = path or record_path()
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def append_record(rec: dict, path: Path | None = None) -> None:
    path = path or record_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps(rec, sort_keys=True) + "\n")


def parse_report(text: str) -> tuple[int, int, int] | None:
    """(passed, total, cents) from '**20 of 20 pass; 54¢ spent.**' in a golden report."""
    m = re.search(r"\*\*(\d+) of (\d+) pass; (\d+(?:\.\d+)?)¢ spent", text)  # cents may be fractional (e.g. 28.56015¢)
    return (int(m[1]), int(m[2]), round(float(m[3]))) if m else None


def last_score(records: list[dict], suite: str, before_sha: str | None = None) -> dict | None:
    """The last recorded staging score for the suite from a sha other than before_sha."""
    for rec in reversed(records):
        if rec.get("kind") == "score" and rec.get("target") == "staging" and rec.get("suite") == suite and rec.get("sha") != before_sha and not rec.get("skipped") and "passed" in rec:
            return rec
    return None


def is_drop(prev: dict | None, passed: int, total: int) -> bool:
    if not prev or not prev.get("total") or not total:
        return False
    return passed / total < prev["passed"] / prev["total"]


def is_explained(records: list[dict], sha: str) -> bool:
    return any(r.get("kind") == "explained" and r.get("sha") == sha for r in records)


def gate_state(records: list[dict], sha: str) -> tuple[bool, str]:
    """(stopped, reason) for a live-server deploy of sha. Stopped when a staging score at sha dropped below the one before it
    and nobody explained it, or when the touched deploy has no staging score at all."""
    scores = [r for r in records if r.get("kind") == "score" and r.get("target") == "staging" and r.get("sha") == sha and r.get("suite") in SUITES and not r.get("skipped")]
    if not scores:
        return True, f"no staging gold-set score recorded for {sha}; run: python3 next/scripts/deploy_gate.py run-staging"
    latest = {r["suite"]: r for r in scores}  # a rerun at the same sha replaces its earlier row
    drops = [r for r in latest.values() if r.get("dropped")]
    if drops and not is_explained(records, sha):
        d = drops[-1]
        return True, f"{d['suite']} dropped to {d['passed']}/{d['total']} from {d.get('prev_passed')}/{d.get('prev_total')}; explain it: python3 next/scripts/deploy_gate.py explain \"<why>\""
    return False, "ok"


def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True).stdout.strip()


def head_sha() -> str:
    return git("rev-parse", "--short", "HEAD") or "unknown"


def last_deployed_sha(records: list[dict], target: str) -> str | None:
    for rec in reversed(records):
        if rec.get("kind") == "deploy" and rec.get("target") == target and rec.get("sha"):
            return rec["sha"]
    return None


def changed_since(sha: str | None) -> list[str]:
    if not sha:
        return []
    return [l for l in git("diff", "--name-only", f"{sha}..HEAD").splitlines() if l]


def touched_now(target: str, records: list[dict] | None = None) -> list[str]:
    records = records if records is not None else read_records()
    base = last_deployed_sha(records, target)
    if base is None:
        # Nothing recorded yet: treat the deploy as touching prompts, so the first recorded score is real.
        return ["(no earlier deploy recorded)"]
    return touches_prompt(changed_since(base))


def record_scores(sha: str, results: dict[str, tuple[int, int, int] | None], path: Path | None = None) -> list[dict]:
    """Append one score row per suite; mark a drop against the last row from another sha. Returns the rows."""
    records = read_records(path)
    rows = []
    for suite in SUITES:
        res = results.get(suite)
        if res is None:
            row = {"kind": "score", "target": "staging", "suite": suite, "sha": sha, "skipped": True, "reason": "no runnable gold set" if suite == "talk" and not (REPO / "next/evals/talk_gold.json").exists() else "run did not finish", "ts": int(time.time())}
        else:
            passed, total, cents = res
            prev = last_score(records, suite, before_sha=sha)
            row = {"kind": "score", "target": "staging", "suite": suite, "sha": sha, "passed": passed, "total": total, "cents": cents, "ts": int(time.time())}
            if prev:
                row.update(prev_passed=prev["passed"], prev_total=prev["total"], prev_sha=prev.get("sha"))
            row["dropped"] = is_drop(prev, passed, total)
        append_record(row, path)
        rows.append(row)
    return rows


def run_bridge_staging() -> tuple[int, int, int] | None:
    """Open the staging eval door, run the Bridge golden at the staging URL, close the door again. Staging only."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from staging_setup import STAGING, load  # noqa: E402
    py = sys.executable
    here = Path(__file__).resolve().parent
    if subprocess.run([py, str(here / "staging_ai.py"), "eval-open"]).returncode != 0:
        return None
    try:
        env = load(STAGING)
        base = f"https://{env['SUPABASE_PROJECT_REF']}.supabase.co/functions/v1/api"
        run_env = {**os.environ, "PRESENCE_BRIDGE_EVAL_TOKEN": env.get("PRESENCE_BRIDGE_EVAL_TOKEN", "")}
        tag = f"gate-{head_sha()}"
        result = subprocess.run(["deno", "run", "--allow-net", "--allow-read", "--allow-env", "--allow-write", str(here / "eval_bridge_golden.ts"), "--base", base, "--cap", str(BRIDGE_CAP_CENTS), "--tag", tag],
                                cwd=str(REPO), env=run_env, capture_output=True, text=True)
        report = eval_report_path("bridge", tag)
        if report.exists():
            return parse_report(report.read_text())
        # The prior gate hid this diagnostic with capture_output, which made a missing report look like an
        # unexplained skipped score. The eval token is never printed.
        tail = result.stderr.replace(run_env["PRESENCE_BRIDGE_EVAL_TOKEN"], "<hidden>").strip().splitlines()[-20:]
        print("bridge staging eval produced no report:", report)
        if tail:
            print("\n".join(tail))
        return None
    finally:
        subprocess.run([py, str(here / "staging_ai.py"), "eval-close"])


def run_talk_staging() -> tuple[int, int, int] | None:
    """Replay the Talk gold set (next/evals/talk_gold.json) on staging with ordinary test accounts; no eval door needed."""
    here = Path(__file__).resolve().parent
    tag = f"gate-{head_sha()}"
    subprocess.run([sys.executable, str(here / "eval_talk_gold.py"), "--tag", tag, "--cap-cents", str(CAP_CENTS)], capture_output=True, text=True)
    report = eval_report_path("talk", tag)
    return parse_report(report.read_text()) if report.exists() else None


def run_staging() -> int:
    sha = head_sha()
    rows = record_scores(sha, {"bridge": run_bridge_staging(), "talk": run_talk_staging() if (Path(__file__).resolve().parents[1] / "evals" / "talk_gold.json").exists() else None})
    for r in rows:
        print("gate", r["suite"], "skipped (" + r["reason"] + ")" if r.get("skipped") else f"{r['passed']}/{r['total']} {r['cents']}¢" + (" DROPPED" if r["dropped"] else ""))
    stopped, why = gate_state(read_records(), sha)
    print("gate", "STOPPED: " + why if stopped else "green")
    return 3 if stopped else 0


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else ""
    if cmd == "touched":
        files = touched_now("staging" if "--staging" in argv else "hosted")
        print("\n".join(files) if files else "no prompt or model-setting change")
        return 0 if files else 1
    if cmd == "run-staging":
        return run_staging()
    if cmd == "require":
        if not touched_now("hosted"):
            print("gate: no prompt or model-setting change since the last live deploy")
            return 0
        stopped, why = gate_state(read_records(), head_sha())
        print("gate:", ("STOPPED, " + why) if stopped else "green")
        return 3 if stopped else 0
    if cmd == "explain" and len(argv) > 1:
        append_record({"kind": "explained", "sha": head_sha(), "why": argv[1][:500], "ts": int(time.time())})
        print("gate: explanation recorded for", head_sha())
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
