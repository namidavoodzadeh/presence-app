#!/usr/bin/env python3
"""Install the one-minute APNs outbox drain without printing credentials.

The function secret and the Vault secret both come from the protected push-drain.env created by
set_function_secrets.py. The scheduled SQL resolves values from Vault at run time; cron.job contains no key.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from set_function_secrets import ROOT, read_values  # noqa: E402
from supabase_api import run_sql  # noqa: E402
from supabase_env import load  # noqa: E402


def quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> int:
    env = load()
    drain = read_values(ROOT / "secrets/push-drain.env", ("PUSH_DRAIN_SECRET",))["PUSH_DRAIN_SECRET"]
    values = {
        "presence_push_url": env["SUPABASE_URL"],
        "presence_push_apikey": env["SUPABASE_ANON_KEY"],
        "presence_push_drain": drain,
    }
    statements = [
        "select cron.unschedule(jobid) from cron.job where jobname = 'presence-push-drain';",
        "delete from vault.secrets where name in ('presence_push_url','presence_push_apikey','presence_push_drain');",
    ]
    for name, value in values.items():
        statements.append(f"select vault.create_secret({quote(value)}, {quote(name)}, 'Presence APNs drain');")
    statements.append("""
select cron.schedule(
  'presence-push-drain', '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='presence_push_url') || '/functions/v1/api/internal/push/drain',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name='presence_push_apikey'),
      'x-presence-push-secret', (select decrypted_secret from vault.decrypted_secrets where name='presence_push_drain')
    ),
    body := '{"limit":100}'::jsonb,
    timeout_milliseconds := 50000
  );
  $job$
);
""")
    code, body = run_sql(env, "\n".join(statements))
    for value in values.values():
        body = body.replace(value, "<hidden>")
    print("push schedule", code, body[:300])
    return 0 if code in (200, 201) else 1


if __name__ == "__main__":
    raise SystemExit(main())
