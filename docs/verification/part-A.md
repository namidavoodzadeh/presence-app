# Part A verification, 24 Nov 2026

Source: old repository `namidavoodzadeh/Presence`, snapshot commit `f507c92`, copied as files with no history.

| Task | Status | Evidence |
| --- | --- | --- |
| A2 copy | Copied. Test count NOT yet verified | `find . -size +5M` prints nothing. `cd next && deno task test` could not run in the setup workspace (package registry jsr.io unreachable there). First CI job on the Mac must run it and record the count here |
| A3 map file | Done | `wc -l AGENTS.md` under 100; no mention of the retired setup |
| A4 structure | Partly done | `tools/lint-structure.sh` written and self-tested. Xcode project, `Contract` and `DesignKit` packages still to create on the Mac |
| A5 tokens | Partly done | `tools/lint-tokens.sh` written and self-tested. DesignKit itself still to create |
| A6 LoadState | Written, NOT compiled | `app/Packages/Flows` with tests. `swift test` must run on the Mac |
| A7 contract | Stub only | `contract/openapi.yaml` is empty until package 01 names its routes |
| A8 protection | Done | `tools/protect-tests.sh` and `.claude/settings.json`. `tools/selftest.sh`: 14 passed, 0 failed |

Also copied because server tests read them: `fixtures/`, `site/`, `evals/insight/`. `next/reports/` (33 MB of old run output) was emptied.
