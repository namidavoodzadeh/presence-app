#!/usr/bin/env python3
"""Read-only AI cost per call, from engine_calls on the project the loader points at (HQ d-coo-ai-cost-line-16nov).

Prints, per purpose and model: calls, exact cents (tokens x the ledger rate card, cache writes 1.25x, cache reads 0.05x for
Sonnet 5.5 and 0.1x otherwise: the figure Anthropic bills, not the per-call round-up engine_calls.cents holds) and the
round-up total, so the double count is visible. Counts, tokens and cents only: never a request, a response or a person's id.

    python3 -I next/scripts/ai_cost.py [--since 2026-11-10] [--json out.json]

`model_month()` is the arithmetic behind docs/ops/AI-COST.md: pure, tested in test_ai_cost.py.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

RATES = {"claude-haiku-5-5": (100, 500), "claude-sonnet-5": (300, 1500), "claude-sonnet-5-5": (300, 1500)}  # cents per million in/out


def exact_cents(model: str, inp: int, out: int, cache_write: int = 0, cache_read: int = 0) -> float:
    i, o = RATES.get(model, (300, 1500))
    read = 0.05 if "sonnet-5-5" in model or "opus-5-5" in model else 0.1
    return (inp * i + cache_write * i * 1.25 + cache_read * i * read + out * o) / 1_000_000


def model_month(per_call: dict[str, float], *, sessions: float, turns: float, repair_share: float, bridges: float, users: int = 1) -> dict[str, float]:
    """Cents per month for `users` active people. `per_call` is cents per call by name:
    turn, repair, safety, finish (Talk); live (one Bridge insight read), analyse, rewrite, verify (one Bridge send)."""
    talk_turn = per_call["turn"] + repair_share * per_call["repair"] + per_call["safety"]
    talk = sessions * (turns * talk_turn + per_call["finish"])
    bridge = bridges * (per_call["live"] * 3 + per_call["analyse"] + per_call["rewrite"] + per_call["verify"] + per_call["safety"])
    return {"talk": talk * users, "bridge": bridge * users, "total": (talk + bridge) * users}


def main(argv: list[str]) -> int:
    from supabase_env import load
    from supabase_api import run_sql

    since = argv[argv.index("--since") + 1] if "--since" in argv else "2026-11-01"
    out = argv[argv.index("--json") + 1] if "--json" in argv else None
    env = load()
    code, body = run_sql(env, f"""select purpose, model, count(*) n, sum(input_tokens) i, sum(output_tokens) o,
        sum(coalesce(cache_creation_input_tokens,0)) cw, sum(coalesce(cache_read_input_tokens,0)) cr, sum(cents) billed_rounded_up
        from engine_calls where created_at >= '{since}' group by 1, 2 order by n desc""")
    if code not in (200, 201):
        raise SystemExit(f"query failed {code}")
    rows = []
    for r in json.loads(body):
        c = exact_cents(r["model"], r["i"] or 0, r["o"] or 0, r["cw"], r["cr"])
        rows.append({**r, "exact_cents": round(c, 2), "cents_per_call": round(c / r["n"], 3)})
    print(f"{'purpose':16}{'model':20}{'calls':>7}{'exact¢':>9}{'¢/call':>8}{'rounded-up¢':>13}")
    for r in sorted(rows, key=lambda r: -r["exact_cents"]):
        print(f"{r['purpose']:16}{r['model']:20}{r['n']:>7}{r['exact_cents']:>9}{r['cents_per_call']:>8}{r['billed_rounded_up']:>13}")
    print(f"total exact {round(sum(r['exact_cents'] for r in rows), 1)}¢, per-call round-up {sum(r['billed_rounded_up'] or 0 for r in rows)}¢")
    if out:
        Path(out).write_text(json.dumps(rows, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
