#!/usr/bin/env python3
"""AI credit alerts (CEO 15 Nov: "keep it to the $200 credit"). Read-only on the database, one row to alerts.jsonl per level per cycle.

    python3 next/scripts/ai_budget_alert.py                 # staging snapshot (default loader)
    python3 next/scripts/ai_budget_alert.py --hosted        # hosted, the 'audit' step (read-only)
    python3 next/scripts/ai_budget_alert.py --from-file snapshot.json --dry-run

Reads ledger_snapshot() (migration 0068): month_cents, month_cap_cents, month_pct, level (ok | warn 50% | high 80% | critical 95%),
cycle_starts_at, month_opens_at. When the level rises past one already announced in this cycle it appends ONE row to outputs/control/alerts.jsonl
(type ai_budget_level) and records it in outputs/control/ai-budget-alert.<env>.json. A new cycle (the 25th) resets the record. Never an alert per
call, never a repeat of a level already sent, never a person's data: the row holds only cents, a percentage and dates.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

ORDER = ("ok", "warn", "high", "critical")
MAIN = os.environ.get("PRESENCE_MAIN", "/Users/namid/Documents/Codex/Presence")
CTRL = Path(MAIN) / "outputs" / "control"


def _date(value: object) -> str:
    return str(value)[:10]


def decide(snapshot: dict, state: dict | None, env: str, now: float) -> tuple[dict | None, dict]:
    """The alert row to write (or None) and the new state. Pure."""
    level = snapshot.get("level")
    if level not in ORDER or snapshot.get("month_cap_cents") in (None, 0):
        return None, state or {}
    cycle = _date(snapshot.get("cycle_starts_at"))
    prior = state if state and state.get("cycle") == cycle else {"cycle": cycle, "sent": "ok"}
    if ORDER.index(level) <= ORDER.index(prior["sent"]):
        return None, prior
    cents, cap = int(snapshot.get("month_cents") or 0), int(snapshot["month_cap_cents"])
    opens = _date(snapshot.get("month_opens_at"))
    pct = snapshot.get("month_pct")
    first = {"warn": "Nothing to do yet; watch the pace.",
             "high": "Pause evals and non-urgent staging runs until the cycle resets.",
             "critical": "Stop all evals now. Talk and Bridge will refuse at the cap, and people see the date it opens."}[level]
    row = {"ts": now, "type": "ai_budget_level", "env": env, "level": level, "pct": pct, "month_cents": cents, "month_cap_cents": cap,
           "opens_at": opens,
           "message": f"AI credit ({env}) at {pct}%: {cents:,} of {cap:,} cents this cycle; it resets {opens}. {first}"}
    return row, {"cycle": cycle, "sent": level}


def run(snapshot: dict, env: str, state_path: Path, alerts_path: Path, now: float | None = None, dry_run: bool = False) -> dict | None:
    state = None
    try:
        state = json.loads(state_path.read_text())
    except (OSError, ValueError):
        pass
    row, new_state = decide(snapshot, state, env, time.time() if now is None else now)
    if dry_run:
        return row
    if row:
        alerts_path.parent.mkdir(parents=True, exist_ok=True)
        with alerts_path.open("a") as handle:
            handle.write(json.dumps(row) + "\n")
    if new_state != state:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(new_state))
    return row


def read_snapshot(hosted: bool) -> dict:
    from supabase_api import run_sql  # noqa: E402  (network only at run time)
    if hosted:
        from supabase_env import load_production
        env = load_production("audit")
    else:
        from supabase_env import load
        env = load()
    code, body = run_sql(env, "select public.ledger_snapshot() as s")
    if code not in (200, 201):
        raise SystemExit(f"snapshot failed {code}: {str(body)[:160]}")
    rows = json.loads(body)
    return rows[0]["s"]


def main(argv: list[str]) -> int:
    hosted = "--hosted" in argv
    env = "hosted" if hosted else "staging"
    dry = "--dry-run" in argv
    if "--from-file" in argv:
        snapshot = json.loads(Path(argv[argv.index("--from-file") + 1]).read_text())
    else:
        snapshot = read_snapshot(hosted)
    if "level" not in snapshot:
        print(f"{env}: ledger_snapshot has no level yet (migration 0068 not applied); nothing to alert on")
        return 0
    row = run(snapshot, env, CTRL / f"ai-budget-alert.{env}.json", CTRL / "alerts.jsonl", dry_run=dry)
    print(json.dumps(row) if row else f"{env}: level {snapshot['level']}, {snapshot.get('month_pct')}% of {snapshot.get('month_cap_cents')} cents; no new alert")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
