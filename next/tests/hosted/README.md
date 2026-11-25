# Hosted probes

Acceptance probes that run against the hosted project with test accounts. They are not unit tests (`deno test` does not
pick up `*_probe.ts`) and CI does not run them: the engine builder runs them after a hosted change, and the issue is done
when its probe prints `PASS`.

Every probe reads its inputs from the environment and refuses to start, with a plain message, when one is missing. It never
prints a token. Common inputs:

| Variable | What it is |
| --- | --- |
| `PRESENCE_API_URL` | The hosted API base, e.g. `https://<project>.supabase.co/functions/v1/api` |
| `SUPABASE_ANON_KEY` | The hosted anon key (sent as `apikey`) |

Each probe lists its own test-account inputs at the top.

Exit codes: 0 pass, 1 a check failed, 2 an input is missing.
