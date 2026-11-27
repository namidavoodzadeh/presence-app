#!/usr/bin/env python3
"""sre-01/sre-03: give presence-staging its own model key and a 300¢/day ledger cap. Staging only; never prints a value.

    python3 next/scripts/staging_ai.py secret   # ANTHROPIC_API_KEY from staging.env -> staging function secret
    python3 next/scripts/staging_ai.py eval-open   # PRESENCE_STAGING + PRESENCE_BRIDGE_EVAL + a fresh token (kept in staging.env) + workspace id
    python3 next/scripts/staging_ai.py eval-close  # delete those function secrets again (the eval route answers 404)
    python3 next/scripts/staging_ai.py cap [day_cents] --safety   # redefine ledger_reserve/ledger_snapshot with day 300¢ (or 300..1000; a temporary lift), eval 300¢, no owner extra
    python3 next/scripts/staging_ai.py cap 3000 --safety --owner-approved YYYY-MM-DD   # owner-approved temporary lift, maximum 5000¢; prints its return date
    python3 next/scripts/staging_ai.py limit-on <account-id>   # TL-1 seam: that fictional test account's AI calls get `total_limit`
    python3 next/scripts/staging_ai.py limit-off [<account-id>|--all]
    python3 next/scripts/staging_ai.py limit-list
    python3 next/scripts/staging_ai.py person-extra <test-account-id> <cents>   # a staging-only extra day allowance for one fictional test account (1..300); person-extra-off <id>|--all clears it
Rollback of the cap: re-run supabase/migrations/0068_ai_credit_cycle.sql on staging (its 3,000-cent day cap and the person allowance return; the seam and extra tables are left, unread).
`cap` is built from 0068 (the credit-cycle ledger staging runs), not 0033: 0033's lifetime cap would overwrite the month logic (engine, 16 Nov).
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from staging_setup import STAGING, load  # noqa: E402
from supabase_api import call, run_sql  # noqa: E402

MIG = Path(__file__).resolve().parents[2] / "supabase/migrations/0068_ai_credit_cycle.sql"
# 0073 is 0068 plus the safety-read block (own kind, own 300-cent ceiling). Once 0073 is applied on staging, every `cap` / `print-sql` must be run with
# --safety, or the lift would put 0068's functions back and drop the safety block.
MIG_SAFETY = Path(__file__).resolve().parents[2] / "supabase/migrations/0073_safety_read_ledger.sql"
CAP_CENTS = 300
UNAPPROVED_MAX_CENTS = 1000
OWNER_APPROVED_MAX_CENTS = 5000
OWNER_APPROVAL_DAYS = 14
# staging_ai.py lives at <operations-home>/work/<lane>-wt/next/scripts/; PRESENCE_OPERATIONS_HOME overrides it, as in deploy_gate.py.
OPERATIONS_HOME = Path(os.environ.get("PRESENCE_OPERATIONS_HOME") or Path(__file__).resolve().parents[4])
EVAL_LOCK = OPERATIONS_HOME / "outputs" / "engine" / ".eval-door.lock"
EVAL_LOCK_STALE_SECONDS = 30 * 60


# TL-1 seam (COO 18:20Z 15 Nov, app's Q-APP-TL1-1): a staging-only list of fictional account ids that ledger_reserve refuses with
# `total_limit` before any sum, so the phone can be shown the real 429 body (error daily_limit, limit total_limit) without pausing AI for
# every lane. The table and the check exist only in the SQL this script sends to the staging project; no migration, so hosted never has them.
SEAM_TABLE = "staging_total_limit_accounts"
SEAM_TABLE_SQL = (f"create table if not exists public.{SEAM_TABLE} (person uuid primary key, added_at timestamptz not null default now());\n"
                  f"alter table public.{SEAM_TABLE} enable row level security;\n")
SEAM_ANCHOR = "  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_person::text, 'kind:' || p_kind), 7742));\n"
SEAM_CHECK = (f"  if p_person is not null and not is_eval and exists (select 1 from public.{SEAM_TABLE} where person = p_person) then\n"
              "    return jsonb_build_object('ok', false, 'error', 'total_limit', 'total_used_micros', 0, 'total_cap_micros', 0);\n"
              "  end if;\n")
# QA 19:35Z (Q-QA-16Nov-7): one fictional test account may get an extra day allowance on staging, so a harness run can finish; same rules as the seam:
# the table and the lookup exist only in the SQL sent to staging, never in a migration.
EXTRA_TABLE = "staging_person_extra"
EXTRA_TABLE_SQL = (f"create table if not exists public.{EXTRA_TABLE} (person uuid primary key, extra_cents int not null, added_at timestamptz not null default now());\n"
                   f"alter table public.{EXTRA_TABLE} enable row level security;\n")
EXTRA_ANCHOR = "  if p_person is not null and not is_eval then\n    select coalesce(sum"
EXTRA_LOOKUP = ("  if p_person is not null and not is_eval then\n"
                f"    person_cap := person_cap + coalesce((select extra_cents from public.{EXTRA_TABLE} where person = p_person), 0)::bigint * 10000;\n"
                "  end if;\n")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def capped_sql(day_cents: int = CAP_CENTS, safety: bool = False) -> str:
    sql = (MIG_SAFETY if safety else MIG).read_text()
    for old, new in (("3000 * 10000", f"{day_cents} * 10000"), ("1000 * 10000", f"{CAP_CENTS} * 10000"),
                     ("day_cap + 500 * 10000", "day_cap + 0"), ("person_cap + 500 * 10000", "person_cap + 0"),
                     ("'daily_cap_cents', 3000", f"'daily_cap_cents', {day_cents}"),
                     ("'eval_daily_cap_cents', 1000", f"'eval_daily_cap_cents', {CAP_CENTS}"),
                     ("'owner_preview_extra_cents', 500", "'owner_preview_extra_cents', 0"),
                     (SEAM_ANCHOR, SEAM_ANCHOR + SEAM_CHECK)):
        if old is SEAM_ANCHOR and old not in sql:
            raise SystemExit("0068 changed: the seam anchor line is gone")
        sql = sql.replace(old, new)
    anchor, lookup = EXTRA_ANCHOR, EXTRA_LOOKUP
    if safety:   # 0073 guards the person block with `and not is_safety`: the extra applies to the same people, never to a safety read
        anchor = anchor.replace("not is_eval then", "not is_eval and not is_safety then")
        lookup = lookup.replace("not is_eval then", "not is_eval and not is_safety then")
    if anchor not in sql:
        raise SystemExit("0068/0073 changed: the person-cap anchor is gone")
    sql = sql.replace(anchor, lookup + anchor, 1)
    return SEAM_TABLE_SQL + EXTRA_TABLE_SQL + sql


def secret() -> int:
    env = load(STAGING)
    key = env.get("ANTHROPIC_API_KEY", "")
    if not key:
        print("staging.env has no ANTHROPIC_API_KEY"); return 1
    ref = env["SUPABASE_PROJECT_REF"]
    code, text = call(env, "POST", f"/projects/{ref}/secrets", [{"name": "ANTHROPIC_API_KEY", "value": key}])
    print("secret", code, text.replace(key, "<hidden>")[:150])
    code2, text2 = call(env, "GET", f"/projects/{ref}/secrets")
    print("function secrets now:", sorted(s.get("name") for s in json.loads(text2)) if code2 == 200 else code2)
    return 0 if code in (200, 201) else 1


def cap_args(args: list[str]) -> tuple[int, date | None] | None:
    """Read the cap amount and optional dated owner approval without accepting stray values."""
    values: list[str] = []
    approval: date | None = None
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--safety":
            i += 1
        elif arg == "--owner-approved":
            if approval is not None or i + 1 == len(args):
                return None
            try:
                approval = date.fromisoformat(args[i + 1])
            except ValueError:
                return None
            i += 2
        elif arg.startswith("--"):
            return None
        else:
            values.append(arg)
            i += 1
    if len(values) > 1:
        return None
    try:
        return (int(values[0]) if values else CAP_CENTS), approval
    except ValueError:
        return None


def cap() -> int:
    env = load(STAGING)
    if not staging_only(env):
        print("refusing: the loaded project is not the staging project"); return 1
    args = cap_args(sys.argv[2:])
    if args is None:
        print("usage: cap [day_cents] --safety [--owner-approved YYYY-MM-DD]"); return 1
    day, approved = args
    if "--safety" not in sys.argv[2:]:
        print("refusing: cap requires --safety"); return 1
    if not CAP_CENTS <= day <= OWNER_APPROVED_MAX_CENTS:
        print("day_cents must be 300..5000"); return 1
    if day > UNAPPROVED_MAX_CENTS and approved is None:
        print("day_cents above 1000 requires --owner-approved YYYY-MM-DD"); return 1
    until = approved + timedelta(days=OWNER_APPROVAL_DAYS) if day > UNAPPROVED_MAX_CENTS else None
    code, body = run_sql(env, capped_sql(day, safety=True))
    print("cap", day, code, f"until {until.isoformat()}" if until else "", "" if code in (200, 201) else body[:300])
    return 0 if code in (200, 201) else 1


def staging_only(env: dict[str, str]) -> bool:
    """The seam and the cap are for the staging project only: refuse when the loaded URL is the production project's."""
    from supabase_env import load_public_production
    prod_url = load_public_production().get("SUPABASE_URL", "").rstrip("/")
    return bool(env.get("SUPABASE_URL")) and env["SUPABASE_URL"].rstrip("/") != prod_url


def limit_on(account: str) -> int:
    """Add one fictional test account (account_kind 'test') to the seam. A real person's id is refused."""
    if not UUID_RE.match(account):
        print("refusing: not an account id (a lowercase uuid)"); return 1
    env = load(STAGING)
    if not staging_only(env):
        print("refusing: the loaded project is not the staging project"); return 1
    code, body = run_sql(env, f"insert into public.{SEAM_TABLE} (person) select id from public.profiles where id = '{account}' and account_kind = 'test' on conflict do nothing returning person")
    if code not in (200, 201):
        print("limit-on", code, str(body)[:200]); return 1
    code2, body2 = run_sql(env, f"select 1 as n from public.{SEAM_TABLE} where person = '{account}'")
    if code2 not in (200, 201) or not json.loads(body2 if isinstance(body2, str) else json.dumps(body2)):
        print("refusing: that id is not a test-kind account on staging"); return 1
    print("limit-on: that account's AI calls now get total_limit on staging (run limit-off to clear)")
    return 0


def limit_off(arg: str | None) -> int:
    env = load(STAGING)
    if not staging_only(env):
        print("refusing: the loaded project is not the staging project"); return 1
    if arg and arg != "--all" and not UUID_RE.match(arg):
        print("refusing: not an account id (a lowercase uuid)"); return 1
    where = f" where person = '{arg}'" if arg and arg != "--all" else ""
    code, body = run_sql(env, f"delete from public.{SEAM_TABLE}{where}")
    print("limit-off", code, "" if code in (200, 201) else str(body)[:200])
    return 0 if code in (200, 201) else 1


def limit_list() -> int:
    env = load(STAGING)
    if not staging_only(env):
        print("refusing: the loaded project is not the staging project"); return 1
    code, body = run_sql(env, f"select person, added_at from public.{SEAM_TABLE} order by added_at")
    print("limit-list", code, body if code in (200, 201) else str(body)[:200])
    return 0 if code in (200, 201) else 1


def person_extra(account: str, cents: str) -> int:
    """Give one fictional test account (account_kind 'test') up to 300 extra cents a day on staging. Needs `cap` to have been run once (the lookup)."""
    if not UUID_RE.match(account) or not cents.isdigit() or not 1 <= int(cents) <= 300:
        print("refusing: needs a lowercase account uuid and cents 1..300"); return 1
    env = load(STAGING)
    if not staging_only(env):
        print("refusing: the loaded project is not the staging project"); return 1
    code, body = run_sql(env, EXTRA_TABLE_SQL + f"insert into public.{EXTRA_TABLE} (person, extra_cents) select id, {int(cents)} from public.profiles "
                              f"where id = '{account}' and account_kind = 'test' on conflict (person) do update set extra_cents = {int(cents)}")
    if code not in (200, 201):
        print("person-extra", code, str(body)[:200]); return 1
    code2, body2 = run_sql(env, f"select extra_cents from public.{EXTRA_TABLE} where person = '{account}'")
    if code2 not in (200, 201) or not json.loads(body2 if isinstance(body2, str) else json.dumps(body2)):
        print("refusing: that id is not a test-kind account on staging"); return 1
    print(f"person-extra: that test account has {int(cents)} extra cents a day on staging (person-extra-off to clear)")
    return 0


def person_extra_off(arg: str | None) -> int:
    env = load(STAGING)
    if not staging_only(env):
        print("refusing: the loaded project is not the staging project"); return 1
    if arg and arg != "--all" and not UUID_RE.match(arg):
        print("refusing: not an account id (a lowercase uuid)"); return 1
    where = f" where person = '{arg}'" if arg and arg != "--all" else ""
    code, body = run_sql(env, f"delete from public.{EXTRA_TABLE}{where}")
    print("person-extra-off", code, "" if code in (200, 201) else str(body)[:200])
    return 0 if code in (200, 201) else 1


EVAL_NAMES = ["PRESENCE_STAGING", "PRESENCE_BRIDGE_EVAL", "PRESENCE_BRIDGE_EVAL_TOKEN"]


def acquire_eval_lock() -> bool:
    """Reserve staging's one mutable eval token; stale doors expire after 30 minutes."""
    EVAL_LOCK.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        started_at = int(time.time())
        payload = json.dumps({"pid": os.getpid(), "started_at": started_at}) + "\n"
        try:
            fd = os.open(EVAL_LOCK, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            try:
                held = json.loads(EVAL_LOCK.read_text())
                held_at = int(held.get("started_at", 0))
            except (OSError, ValueError, TypeError):
                held, held_at = {}, 0
            if time.time() - held_at >= EVAL_LOCK_STALE_SECONDS:
                try:
                    EVAL_LOCK.unlink()
                except FileNotFoundError:
                    pass
                continue
            print(f"refusing: eval door locked by pid {held.get('pid', 'unknown')} since {held_at}")
            return False
        with os.fdopen(fd, "w") as f:
            f.write(payload)
        return True
    print("refusing: could not acquire eval door lock")
    return False


def release_eval_lock() -> None:
    try:
        EVAL_LOCK.unlink()
    except FileNotFoundError:
        pass


def eval_open() -> int:
    """Open /eval/bridge/run on STAGING only (the route also needs the PRESENCE_STAGING flag, which production never has)."""
    import secrets as sec
    if not acquire_eval_lock():
        return 1
    env = load(STAGING)
    ref = env["SUPABASE_PROJECT_REF"]
    token = sec.token_hex(24)
    body = [{"name": "PRESENCE_STAGING", "value": "true"}, {"name": "PRESENCE_BRIDGE_EVAL", "value": "true"},
            {"name": "PRESENCE_BRIDGE_EVAL_TOKEN", "value": token}]
    ws = env.get("ANTHROPIC_WORKSPACE_ID", "")
    if not ws:  # the workspace id is a request header, not a credential; reuse the Mac's if staging has none
        f = Path.home() / "Library/Application Support/PresenceHome/.env.anthropic.local"
        for line in f.read_text().splitlines():
            if line.startswith("ANTHROPIC_WORKSPACE_ID="):
                ws = line.split("=", 1)[1].strip().strip('"\'')
    if ws:
        body.append({"name": "ANTHROPIC_WORKSPACE_ID", "value": ws})
    code, text = call(env, "POST", f"/projects/{ref}/secrets", body)
    print("eval-open", code, text.replace(token, "<hidden>")[:120])
    if code not in (200, 201):
        release_eval_lock()
        return 1
    lines = [l for l in STAGING.read_text().splitlines() if not l.startswith("PRESENCE_BRIDGE_EVAL_TOKEN=")]
    STAGING.write_text("\n".join(lines) + f"\nPRESENCE_BRIDGE_EVAL_TOKEN={token}\n")
    return 0


def eval_close() -> int:
    env = load(STAGING)
    ref = env["SUPABASE_PROJECT_REF"]
    try:
        code, text = call(env, "DELETE", f"/projects/{ref}/secrets", EVAL_NAMES)
        print("eval-close", code, text[:120])
        return 0 if code in (200, 201, 204) else 1
    finally:
        release_eval_lock()


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "print-sql":  # the exact SQL `cap` sends to staging; read by the PGlite test, no network
        nums = [a for a in sys.argv[2:] if not a.startswith("--")]
        print(capped_sql(int(nums[0]) if nums else CAP_CENTS, "--safety" in sys.argv))
        raise SystemExit(0)
    if cmd == "limit-on":
        raise SystemExit(limit_on(sys.argv[2] if len(sys.argv) > 2 else ""))
    if cmd == "limit-off":
        raise SystemExit(limit_off(sys.argv[2] if len(sys.argv) > 2 else None))
    if cmd == "person-extra":
        raise SystemExit(person_extra(sys.argv[2] if len(sys.argv) > 2 else "", sys.argv[3] if len(sys.argv) > 3 else ""))
    if cmd == "person-extra-off":
        raise SystemExit(person_extra_off(sys.argv[2] if len(sys.argv) > 2 else None))
    if cmd == "limit-list":
        raise SystemExit(limit_list())
    raise SystemExit({"secret": secret, "cap": cap, "eval-open": eval_open, "eval-close": eval_close}[cmd]())
