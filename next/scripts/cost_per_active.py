#!/usr/bin/env python3
"""AI cost per active person (CEO readiness plan 15 Nov, due Wed 18 Nov). Read-only, aggregates only.

    python3 next/scripts/cost_per_active.py [--days 7] [--scope all|real]          # staging (default loader)
    python3 next/scripts/cost_per_active.py --hosted --scope real [--days 7]               # hosted, 'audit' step

What it reads: usage_ledger (micros, kind, person, utc_day), engine_calls (purpose, model, token counts, cents),
profiles (the is_example / is_preview / persona flags). Every query returns sums, counts and percentiles computed in
the database; no person id, no request or response column, no message text ever leaves it (tests hold that).

Active person = a person with at least one non-eval ledger row in the window (every product AI action reserves one),
so people who only open the map are not counted: the per-person figure is an upper bound on cost per app user.
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

TOTAL_CAP_CENTS = 20000  # ledger_reserve, migration 0033 (lifetime, every row ever written, eval included)
SHARED_DAY_CAP_CENTS = 3000  # 0033, non-eval rows of one UTC day
PERSON_DAY_CAP_CENTS = 300  # 0033
SCOPES = ("all", "real")

# Mirrors next/engine/model/client.ts RATES_CENTS_PER_MILLION, WORST_RATE and usageCents (a test compares them).
RATES_CENTS_PER_MILLION = {"claude-haiku-5-5": (100, 500), "claude-sonnet-5": (300, 1500), "claude-sonnet-5-5": (300, 1500)}
WORST_RATE = (300, 1500)


def exact_cents(model: str, input_tokens: float, output_tokens: float, cache_write: float, cache_read: float) -> float:
    """usageCents without the per-call Math.ceil: what the provider bills for the same tokens."""
    i, o = RATES_CENTS_PER_MILLION.get(model, WORST_RATE)
    read = 0.05 if re.search(r"claude-(?:sonnet|opus)-5-5", model) else 0.1
    return (input_tokens * i + cache_write * i * 1.25 + cache_read * i * read + output_tokens * o) / 1_000_000


def purpose_table(rows: list[dict]) -> list[dict]:
    """Per purpose and model: calls, ledger cents (each call rounded up to a whole cent, as the caps count it) and exact cents."""
    out = []
    for r in rows:
        calls = int(_f(r.get("calls")))
        exact = exact_cents(str(r.get("model")), _f(r.get("input_sum")), _f(r.get("output_sum")),
                            _f(r.get("cache_write_sum")), _f(r.get("cache_read_sum")))
        out.append({"purpose": r.get("purpose"), "model": r.get("model"), "calls": calls,
                    "ledger_cents": _f(r.get("cents")), "exact_cents": round(exact, 2),
                    "errors": int(_f(r.get("errors"))), "error_ledger_cents": _f(r.get("error_cents")),
                    "exact_cents_per_call": round(exact / calls, 3) if calls else None,
                    "ms_p50": r.get("ms_p50"), "ms_p95": r.get("ms_p95")})
    return out


# Free-text columns never leave the database as themselves. kind, purpose and model are unconstrained strings in the
# engine contract, so each is mapped to one of these closed lists inside the SQL; anything else becomes 'other'.
# A new value shows up as 'other' until someone adds it here (the test compares the lists with the code).
LEDGER_KINDS = ("next-engine", "import_ai", "check", "insight", "talk", "bridge", "mirror", "reading", "checkin")
PURPOSES = ("turn", "finish", "finish_repair", "analyse", "analyse_repair", "why", "why_repair", "rewrite", "reword",
            "reword_repair", "repair", "safety", "mirror_observe", "mirror_observe_repair", "mirror_synthesise",
            "mirror_synthesise_repair")
MODELS = tuple(RATES_CENTS_PER_MILLION)


def _closed(col: str, values: tuple[str, ...]) -> str:
    """SQL expression: the column's value when it is in the closed list, else 'other'. Values are constants from this file."""
    for v in values:
        if not re.fullmatch(r"[a-z0-9_.-]+", v):
            raise ValueError(f"unsafe constant {v!r}")
    return f"case when {col} in ({', '.join(repr(v) for v in values)}) then {col} else 'other' end"


# Columns that hold a person's words. No query here may name them.
TEXT_COLUMNS = ("request", "response", "receipt", "detail", "text", "quote")


def _window(days: int) -> str:
    if not isinstance(days, int) or isinstance(days, bool) or not 1 <= days <= 90:
        raise ValueError("days must be an int from 1 to 90")
    return f"created_at >= now() - interval '{days} days'"


def _scope_filter(scope: str, person_col: str) -> str:
    """'real': only people who are not example, preview or persona accounts. 'all': every person (staging is all personas)."""
    if scope not in SCOPES:
        raise ValueError(f"scope must be one of {SCOPES}")
    if scope == "all":
        return f"{person_col} is not null"
    return (f"{person_col} in (select id from profiles where not is_example and not is_preview and persona is null)")


def queries(days: int, scope: str) -> dict[str, str]:
    w = _window(days)
    sl = _scope_filter(scope, "person")
    led = f"from usage_ledger where {w} and kind not like 'eval:%' and not owner_preview and {sl}"
    spent = "coalesce(spent_micros, reserved_micros)"
    return {
        "people": (
            f"with p as (select person, sum({spent}) / 10000.0 as cents, count(distinct utc_day) as days {led} group by person),"
            f" d as (select person, utc_day, sum({spent}) / 10000.0 as cents {led} group by person, utc_day)"
            " select (select count(*) from p) as active_people,"
            " (select coalesce(sum(cents), 0) from p) as cents,"
            " (select percentile_cont(0.5) within group (order by cents) from p) as person_p50,"
            " (select percentile_cont(0.9) within group (order by cents) from p) as person_p90,"
            " (select max(cents) from p) as person_max,"
            " (select avg(days) from p) as active_days_mean,"
            " (select count(*) from d) as person_days,"
            " (select percentile_cont(0.5) within group (order by cents) from d) as day_p50,"
            " (select percentile_cont(0.9) within group (order by cents) from d) as day_p90,"
            " (select max(cents) from d) as day_max,"
            " (select count(*) from d where cents >= 0.8 * " + str(PERSON_DAY_CAP_CENTS) + ") as days_near_person_cap"
        ),
        "kinds": (
            f"select {_closed('kind', LEDGER_KINDS)} as kind, count(*) as rows, count(distinct person) as people,"
            f" sum({spent}) / 10000.0 as cents {led} group by 1 order by cents desc"
        ),
        "purposes": (
            f"select {_closed('purpose', PURPOSES)} as purpose, {_closed('model', MODELS)} as model, count(*) as calls, sum(cents) as cents, count(*) filter (where error is not null) as errors,"
            " coalesce(sum(cents) filter (where error is not null), 0) as error_cents, coalesce(sum(input_tokens), 0) as input_sum,"
            " coalesce(sum(output_tokens), 0) as output_sum, coalesce(sum(cache_read_input_tokens), 0) as cache_read_sum,"
            " coalesce(sum(cache_creation_input_tokens), 0) as cache_write_sum,"
            " percentile_cont(0.5) within group (order by ms) as ms_p50,"
            " percentile_cont(0.95) within group (order by ms) as ms_p95"
            f" from engine_calls where {w} and {_scope_filter(scope, 'person')}"
            " and purpose not in ('sim_user', 'check', 'reading')"
            " group by 1, 2 order by cents desc"
        ),
        "ledger": (
            f"select (select coalesce(sum({spent}), 0) / 10000.0 from usage_ledger) as total_cents,"
            f" (select coalesce(sum({spent}), 0) / 10000.0 from usage_ledger where kind like 'eval:%') as eval_total_cents,"
            f" (select coalesce(max(c), 0) from (select sum({spent}) / 10000.0 as c from usage_ledger"
            f"   where {w} and kind not like 'eval:%' group by utc_day) x) as shared_day_max_cents,"
            f" (select coalesce(sum({spent}), 0) / 10000.0 from usage_ledger where {w}) as window_all_cents,"
            f" (select coalesce(sum({spent}), 0) / 10000.0 from usage_ledger where {w} and kind like 'eval:%') as window_eval_cents"
        ),
    }


def _f(v) -> float:
    return 0.0 if v is None else float(v)


def project(people: dict, ledger: dict, days: int, users: tuple[int, ...] = (100, 1000, 10000)) -> dict:
    """Pure: monthly cost per active person and what the 0033 caps do at a given count of active people.
    Assumes cost grows linearly with people (no caching or routing gains), which is conservative."""
    active = int(_f(people.get("active_people")))
    cents = _f(people.get("cents"))
    per_active_month = cents / active * 30.0 / days if active else None
    active_days = _f(people.get("active_days_mean"))
    # mean cents per active person-day; drives the shared day cap
    per_day = cents / _f(people.get("person_days")) if _f(people.get("person_days")) else None
    total_left = TOTAL_CAP_CENTS - _f(ledger.get("total_cents"))
    out = {"active_people": active, "window_days": days, "cents_per_active_month": per_active_month,
           "cents_per_active_day": per_day, "active_days_per_window_mean": active_days or None,
           "total_cap_cents_left": total_left, "at": []}
    for n in users:
        if per_active_month is None:
            out["at"].append({"active_people": n, "monthly_cents": None, "days_to_total_cap": None,
                              "daily_active_for_shared_cap": None})
            continue
        monthly = per_active_month * n
        daily = monthly / 30.0
        out["at"].append({
            "active_people": n,
            "monthly_cents": round(monthly, 1),
            "days_to_total_cap": round(total_left / daily, 1) if daily > 0 else None,
            "shared_day_cap_hit": bool(daily > SHARED_DAY_CAP_CENTS),
        })
    out["daily_active_people_at_shared_cap"] = math.floor(SHARED_DAY_CAP_CENTS / per_day) if per_day else None
    return out


def _rows(env, sql: str) -> list[dict]:
    from supabase_api import run_sql  # noqa: E402  (network only at run time)
    code, body = run_sql(env, sql)
    if code not in (200, 201):
        raise SystemExit(f"query failed {code}: {body[:200]}")
    return json.loads(body)


def check_closed(rows: list[dict], column: str, values: tuple[str, ...]) -> list[dict]:
    """Second wall behind the SQL: a response whose label is outside the closed list is refused, not printed."""
    for r in rows:
        if r.get(column) not in values + ("other",):
            raise SystemExit(f"refused: {column} outside the closed list in a response row")
    return rows


def measure(env, days: int, scope: str) -> dict:
    q = queries(days, scope)
    people = _rows(env, q["people"])[0]
    ledger = _rows(env, q["ledger"])[0]
    return {"scope": scope, "days": days, "people": people, "kinds": check_closed(_rows(env, q["kinds"]), "kind", LEDGER_KINDS),
            "purposes": purpose_table(check_closed(check_closed(_rows(env, q["purposes"]), "purpose", PURPOSES), "model", MODELS)), "ledger": ledger, "projection": project(people, ledger, days)}


def main(argv: list[str]) -> int:
    days = int(argv[argv.index("--days") + 1]) if "--days" in argv else 7
    scope = argv[argv.index("--scope") + 1] if "--scope" in argv else "all"
    if "--hosted" in argv:
        from supabase_env import load_production
        env = load_production("audit")  # read-only counts (COO 10 Nov); errors name the step, never a value
    else:
        from supabase_env import load
        env = load()  # sre-08: the default loader is staging
    result = measure(env, days, scope)
    result["env"] = "hosted" if "--hosted" in argv else "staging"
    print(json.dumps(result, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
