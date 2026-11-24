#!/usr/bin/env python3
"""Kill switch per AI feature (migration 0040). Never prints a secret.

    python3 next/scripts/ai_switch.py                    # show every switch
    python3 next/scripts/ai_switch.py bridge off "why"   # stop all Bridge model calls (any lane may do this to stop harm; post on HQ at once)
    python3 next/scripts/ai_switch.py bridge on          # turn back on (the owner's call)

Features: talk, bridge, import, mirror. Off means the ledger refuses the reserve, so no provider call is made: Talk saves the
text and extracts nothing; Bridge answers ai_off and the app sends as written. The risk floor does not use the ledger and keeps
working. The API reads the switches at most every 10 seconds, so the effect lands within that.
Add --env <path> to act on staging (a supabase.env-layout file).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_api import run_sql  # noqa: E402
from supabase_env import load  # noqa: E402

FEATURES = ("talk", "bridge", "import", "mirror")


def main(argv: list[str]) -> int:
    env_path = None
    if "--env" in argv:
        i = argv.index("--env")
        env_path = Path(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    env = load(env_path)
    if not argv:
        print(run_sql(env, "select feature, enabled, note, changed_at from public.ai_switches order by 1")[1])
        return 0
    feature, state = argv[0], argv[1] if len(argv) > 1 else ""
    if feature not in FEATURES or state not in ("on", "off"):
        print(__doc__)
        return 2
    note = (argv[2] if len(argv) > 2 else "").replace("'", "''")[:300]
    code, text = run_sql(env, f"update public.ai_switches set enabled = {'true' if state == 'on' else 'false'}, "
                              f"note = '{note}', changed_at = now() where feature = '{feature}' returning feature, enabled, changed_at")
    print(code, text)
    return 0 if code in (200, 201) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
