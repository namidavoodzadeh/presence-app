#!/usr/bin/env python3
"""Pull new tester reports (POST /feedback, COO 12:30 10-31) into outputs/qa/inbox/<date>/ for verify to triage
into BUGS.md. <date> is the UTC day this pull ran on, so one run's haul lands together.

Idempotent: only rows with pulled_at still null are fetched; each one is marked pulled (pulled_at = now())
right after its JPEG and JSON are written, so a report is never written twice and a failed run (a write that
throws before the mark) is retried next time. No value from the secrets files is ever printed.

    python3 next/scripts/pull_feedback.py            # pull everything new
    python3 next/scripts/pull_feedback.py --dry-run  # print what would be pulled, write nothing, mark nothing
    python3 next/scripts/pull_feedback.py --backfill-hq  # rebuild outputs/control/hq-reports.jsonl from the inbox files (no database)

Every pulled report also appends one row (report_id, at, source, reporter_kind, build_kind, screen, build; no words)
to outputs/control/hq-reports.jsonl, the file HQ's 'Your reports' panel is pointed at.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from supabase_env import load_for_step, service_headers  # noqa: E402
from supabase_api import run_sql  # noqa: E402


def q(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


class Missing(Exception):
    """The screenshot object is gone (404): the report text is still worth keeping."""


class Failed(Exception):
    """A transient failure on one report: leave it unpulled, go on to the next, retry next run."""


def download(env: dict[str, str], path: str) -> bytes:
    req = urllib.request.Request(f"{env['SUPABASE_URL']}/storage/v1/object/feedback/{path}")
    for name, value in service_headers(env).items():
        req.add_header(name, value)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise Missing(path)
        raise Failed(f"download {path} failed: {e.code}")
    except (urllib.error.URLError, OSError) as e:
        raise Failed(f"download {path} failed: {type(e).__name__}")


def write_atomic(path: Path, data: bytes) -> None:
    """Write beside the target and rename, so a crash never leaves a half file that --mark-existing would trust."""
    tmp = path.with_name(path.name + ".part")
    tmp.write_bytes(data)
    tmp.replace(path)


def owner_ids() -> set[str]:
    """Profile ids of the owner (one uuid per line in outputs/control/feedback-owner-ids.txt; not secret)."""
    f = ROOT / "outputs/control/feedback-owner-ids.txt"
    try:
        return {l.strip() for l in f.read_text().splitlines() if l.strip() and not l.startswith("#")}
    except OSError:
        return set()


def reporter_kind(row: dict, owners: set[str]) -> str:
    """owner | friend | test. A flagged account (canary, reviewer, test) or a tester-token submission is 'test'."""
    if row.get("account_kind") or not row.get("reporter"):
        return "test"
    return "owner" if row["reporter"] in owners else "friend"


def log_event(event: dict) -> None:
    f = ROOT / "outputs/control/tester-feedback-events.jsonl"
    f.parent.mkdir(parents=True, exist_ok=True)
    with f.open("a", encoding="utf-8") as out:
        out.write(json.dumps(event, sort_keys=True) + "\n")


def hq_row(report_id: str, at: str, reporter_kind_: str, body, source_default: str = "report-button") -> dict:
    """One row for HQ's reports panel: ids and facts only. No words (note, log), no screenshot path (Q-ENG-REPORTS-HQ-1)."""
    b = body if isinstance(body, dict) else {}
    facts = b.get("facts") if isinstance(b.get("facts"), dict) else {}
    return {"report_id": report_id, "at": at, "source": b.get("source") or source_default, "reporter_kind": reporter_kind_,
            "build_kind": b.get("build_kind") or facts.get("build_kind"), "screen": b.get("screen"), "build": b.get("build")}


def append_hq(row: dict, path: Path | None = None) -> bool:
    """Append to outputs/control/hq-reports.jsonl unless that report_id is already there. True when written."""
    f = path or (ROOT / "outputs/control/hq-reports.jsonl")
    f.parent.mkdir(parents=True, exist_ok=True)
    try:
        for line in f.read_text(encoding="utf-8").splitlines():
            try:
                if json.loads(line).get("report_id") == row["report_id"]:
                    return False
            except ValueError:
                continue
    except OSError:
        pass
    with f.open("a", encoding="utf-8") as out:
        out.write(json.dumps(row, sort_keys=True) + "\n")
    return True


def backfill_hq(inbox: Path | None = None, path: Path | None = None) -> int:
    """Rebuild missing rows from every outputs/qa/inbox/<day>/<report>.json already pulled (reads files, not the database)."""
    n = 0
    for p in sorted((inbox or ROOT / "outputs/qa/inbox").glob("*/*.json")):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(d, dict) or not d.get("report_id"):
            continue
        at = str(d.get("created_at") or "")
        if append_hq(hq_row(d["report_id"], at, d.get("reporter_kind") or "test", d.get("body")), path):
            n += 1
    return n


def mark_existing(env: dict[str, str], folder: Path, dry: bool) -> int:
    """Mark pulled only the unpulled rows whose <report_id>.json already sits in `folder` (no backfill of anything else)."""
    have = {p.stem for p in folder.glob("*.json")}
    code, body = run_sql(env, "select id, report_id from feedback where pulled_at is null")
    if code not in (200, 201):
        raise SystemExit(f"query failed {code}: {body[:300]}")
    n = 0
    for row in json.loads(body):
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in row["report_id"])
        if safe not in have:
            continue
        if not dry:
            code, body = run_sql(env, f"update feedback set pulled_at = now() where id = {q(row['id'])};")
            if code not in (200, 201):
                raise SystemExit(f"marking {row['report_id']} pulled failed {code}: {body[:300]}")
        n += 1
    print(f"pull_feedback: {'would mark' if dry else 'marked'} {n} already-copied report(s) pulled")
    return 0


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    if "--backfill-hq" in argv:   # files only: no loader is touched, nothing is read from or changed in the database
        print(f"pull_feedback: wrote {backfill_hq()} row(s) to outputs/control/hq-reports.jsonl")
        return 0
    env = load_for_step("pull_feedback")  # production through the no-echo loader; PRESENCE_SUPABASE_ENV=staging for staging
    if "--backfill-hq" in argv:   # files only; nothing is read from or changed in the database
        print(f"pull_feedback: wrote {backfill_hq()} row(s) to outputs/control/hq-reports.jsonl")
        return 0
    if "--mark-existing" in argv:
        return mark_existing(env, Path(argv[argv.index("--mark-existing") + 1]), dry)
    code, body = run_sql(env, "select f.id, f.report_id, f.reporter, f.body, f.screenshot_path, f.created_at, p.account_kind "
                              "from feedback f left join profiles p on p.id = f.reporter where f.pulled_at is null order by f.created_at")
    if code not in (200, 201):   # an older database without account_kind: the plain read still pulls every account
        code, body = run_sql(env, "select id, report_id, reporter, body, screenshot_path, created_at from feedback where pulled_at is null order by created_at")
    if code not in (200, 201):
        raise SystemExit(f"query failed {code}: {body[:300]}")
    rows = json.loads(body)
    if not rows:
        print("pull_feedback: nothing new")
        return 0
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_dir = ROOT / "outputs/qa/inbox" / day
    if not dry:
        out_dir.mkdir(parents=True, exist_ok=True)
    owners = owner_ids()
    pulled, failed = 0, 0
    for row in rows:
        report_id = row["report_id"]
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in report_id)
        print(f"{'would pull' if dry else 'pulling'} {report_id} ({row['created_at']})")
        if dry:
            continue
        kind = reporter_kind(row, owners)
        shot_missing = False
        try:
            if row.get("screenshot_path"):
                try:
                    write_atomic(out_dir / f"{safe_name}.jpg", download(env, row["screenshot_path"]))
                except Missing:
                    shot_missing = True   # keep the words; the screenshot is gone from storage
            # no screenshot_path: the report was sent without one (v1.71); nothing to download, not "missing"
        except Failed as e:
            failed += 1
            print(f"pull_feedback: {report_id} left for the next run ({e})")
            continue
        meta = {"id": row["id"], "report_id": report_id, "reporter": row["reporter"], "reporter_kind": kind,
                "body": row["body"], "created_at": row["created_at"]}
        if shot_missing:
            meta["screenshot_missing"] = True
        write_atomic(out_dir / f"{safe_name}.json", (json.dumps(meta, indent=1, ensure_ascii=False) + "\n").encode("utf-8"))
        code, body = run_sql(env, f"update feedback set pulled_at = now() where id = {q(row['id'])};")
        if code not in (200, 201):
            failed += 1
            print(f"pull_feedback: marking {report_id} pulled failed {code}; it is copied and will be marked next run")
            continue
        append_hq(hq_row(report_id, str(row["created_at"]), kind, row["body"]))
        log_event({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "type": "tester_feedback_report",
                   "report_id": report_id, "reporter_kind": kind,
                   "build_kind": (row["body"].get("build_kind") if isinstance(row["body"], dict) else None), "file": f"{out_dir.relative_to(ROOT)}/{safe_name}.json"})
        pulled += 1
    print(f"pull_feedback: {'would pull' if dry else 'pulled'} {len(rows) if dry else pulled} report(s){'' if dry else f' into {out_dir.relative_to(ROOT)}'}"
          + (f"; {failed} left for the next run" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
