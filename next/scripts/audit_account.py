#!/usr/bin/env python3
"""Read-only audit of one preview account on the hosted project (COO check-in 2026-10-28 00:55, item 11).

Prints what the account holds now and what changed since a moment, by table, with ids, timestamps and counts only:
never a message, a belief statement or a bridge text (the owner's words stay in the database).

    python3 next/scripts/audit_account.py --persona nami --since 2026-10-27T13:29:00Z [--json out.json]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from supabase_env import load  # noqa: E402
from supabase_api import run_sql  # noqa: E402


def rows(env, sql: str):
    code, body = run_sql(env, sql)
    if code not in (200, 201):
        raise SystemExit(f"query failed {code}: {body[:300]}")
    return json.loads(body)


def main(argv: list[str]) -> int:
    persona = argv[argv.index("--persona") + 1] if "--persona" in argv else "nami"
    since = argv[argv.index("--since") + 1] if "--since" in argv else "2026-10-27T13:29:00Z"
    out = argv[argv.index("--json") + 1] if "--json" in argv else None
    env = load()
    prof = rows(env, f"select id, name, is_example, is_preview, tz, map_delete_at, created_at, updated_at from profiles where persona = '{persona}'")
    if not prof:
        raise SystemExit(f"no profile for persona {persona}")
    me = prof[0]["id"]
    s = f"'{since}'::timestamptz"
    report = {"persona": persona, "id": me, "since": since, "profile": prof[0]}
    report["conversations"] = rows(env, f"""
        select c.id, c.title, c.status, c.source, c.mode, c.started_at, c.finished_at, c.deleted_at, c.created_at,
               (select count(*) from messages m where m.conversation_id = c.id) as messages,
               (select count(*) from messages m where m.conversation_id = c.id and m.role = 'me') as my_turns,
               (select count(*) from messages m where m.conversation_id = c.id and m.deleted_at is not null) as deleted_messages,
               (select count(*) from receipts r where r.conversation_id = c.id) as receipts
        from conversations c where c.owner = '{me}' order by c.created_at""")
    report["beliefs"] = rows(env, f"""
        select status, source, count(*) as n, count(deleted_at) as deleted, min(created_at) as first, max(created_at) as last
        from beliefs where owner = '{me}' group by 1, 2 order by 1, 2""")
    report["outside"] = rows(env, f"select count(*) as n from outside_perspectives where owner = '{me}'")
    report["consent"] = rows(env, f"select count(*) as n from consent where owner = '{me}'")
    report["links"] = rows(env, f"""
        select l.id, l.status, l.created_at, l.updated_at,
               case when l.person_a = '{me}' then l.person_b else l.person_a end as other,
               (select name from profiles p where p.id = case when l.person_a = '{me}' then l.person_b else l.person_a end) as other_name
        from links l where l.person_a = '{me}' or l.person_b = '{me}' order by l.created_at""")
    report["link_prefs_mine"] = rows(env, f"""
        select lp.other, p.name as other_name, lp.relationship, lp.share_on, lp.share_areas, lp.cleared_at, lp.unread, lp.pinned, lp.archived, lp.updated_at
        from link_prefs lp join profiles p on p.id = lp.other where lp.owner = '{me}' order by p.name""")
    report["link_prefs_theirs"] = rows(env, f"""
        select lp.owner, p.name as owner_name, lp.relationship, lp.share_on, lp.share_areas, lp.cleared_at, lp.updated_at
        from link_prefs lp join profiles p on p.id = lp.owner where lp.other = '{me}' order by p.name""")
    report["bridges"] = rows(env, f"""
        select b.id, case when b.sender = '{me}' then 'sent' else 'received' end as dir,
               (select name from profiles p where p.id = case when b.sender = '{me}' then b.receiver else b.sender end) as other,
               b.status, b.used, b.outcome, b.deliver_at, b.opened_at, b.withdrawn_at, b.sender_deleted_at, b.receiver_deleted_at, b.created_at, length(b.final) as text_len
        from bridges b where b.sender = '{me}' or b.receiver = '{me}' order by b.created_at""")
    report["drafts"] = rows(env, f"select other, length(text) as text_len, updated_at from drafts where owner = '{me}'")
    report["thread_events"] = rows(env, f"""
        select e.type, e.created_at, (select name from profiles p where p.id = case when e.person_a = '{me}' then e.person_b else e.person_a end) as other, e.person_a = '{me}' as by_me
        from thread_events e where e.person_a = '{me}' or e.person_b = '{me}' order by e.created_at""")
    report["plans"] = rows(env, f"select id, status, soon, at, talked_at, created_at from plans where proposer = '{me}' or other = '{me}' order by created_at")
    report["engine_calls_by_hour"] = rows(env, f"""
        select date_trunc('hour', created_at) as hour, purpose, count(*) as n from engine_calls where person = '{me}' and created_at >= {s} group by 1, 2 order by 1, 2""")
    report["engine_calls_total"] = rows(env, f"select purpose, count(*) as n, min(created_at) as first, max(created_at) as last from engine_calls where person = '{me}' group by 1 order by 1")
    report["errors_since"] = rows(env, f"""
        select ref, where_, code, created_at from errors where person = '{me}' and created_at >= {s} order by created_at""")
    report["mirror"] = rows(env, f"select enabled, who, paused, updated_at from mirror_links where owner = '{me}'")
    report["ledger_mine"] = rows(env, f"select utc_day, kind, count(*) as n, round(sum(spent_micros)/10000.0, 1) as cents from usage_ledger where person = '{me}' group by 1, 2 order by 1, 2")
    text = json.dumps(report, indent=1, default=str)
    if out:
        Path(out).write_text(text)
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
