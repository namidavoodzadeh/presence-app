# Setup report, Mac mini session, 25 Nov 2026

Executed from `docs/handover/mac-session.md` by the CEO chat (Claude, cloud session linked to the Mac mini).

**Result: steps 1 and 2 pass. Every Part A and Part B task is blocked for one reason: this session has no shell on macOS.** Its only route to the Mac is a Linux virtual machine that sees the Mac's folders (`/Users/nami/Documents/Codex/Presence` and `/Volumes/PresenceSSD`). That machine has no Xcode, no Swift for Apple platforms, no `launchctl` and no Deno, and cannot reach `jsr.io` or `deno.land`. Running these tasks elsewhere would not meet "on the Mac", so nothing was faked or approximated.

## Handover steps

| Step | Result | Evidence |
| --- | --- | --- |
| 1 Pause old lanes | pass | `ops/MODE` = PAUSE (owner pause, 24 Nov 19:58 UTC). `outputs/control/health.json` at 13:13 PT 24 Nov: engine, qa, app, app2, app3 all `enabled: false`, `loopAlive: false`. Merge queue off (`outputs/control/mergeq.off`). Old repository otherwise untouched |
| 2 Clone and read `AGENTS.md` | pass | `/Volumes/PresenceSSD/presence-app` at `e159c3c`. `AGENTS.md` read |
| 4 `PROTECT_ALLOW` | not needed | No change to `.github/`, `policy/`, `tools/` or `contract/` was made |

## Tasks

| Task | Result | Why |
| --- | --- | --- |
| A2c `deno task test` and count match | blocked | No Deno on a reachable macOS shell. A cloud attempt also failed: `jsr.io` unreachable (`@std/assert` manifest failed to load), same as recorded in `part-A.md` |
| A4 Xcode project, `swift test`, `tools/selftest.sh` | blocked | Needs Xcode and Swift on macOS |
| A5 DesignKit and token-lint check | blocked | Depends on A4 |
| A6 template screen, build fails on a missing case | blocked | Depends on A4 |
| A7 contract, server test, generated client | blocked | Depends on A4 and A2c; `packages/01/routes.md` does not exist yet |
| B1 self-hosted runner as a service | blocked | Needs `launchctl` and the GitHub runner on macOS, and a runner registration token from the owner's GitHub account |
| B2 pinned Xcode and runtime | blocked | Depends on B1 |
| B3 `ci.yml` | blocked | Depends on B1 and A4 |
| B4 merge policy and branch protection | blocked | Depends on B3; protecting `main` also needs repository admin rights |
| B5 `build-item.yml` | blocked | Depends on B1 and B3 |
| B6 `engine-eval.yml` | blocked | Depends on B1 and A2c |
| B7 `release.yml` | blocked | Depends on B1 and A4 |

Each task was attempted once up to the point of needing macOS; none failed on its own content.

## Needs Nami

1. **Run this handover from a Claude Code session started on the Mac mini itself**, so it has a real macOS shell. On the Mac (in person or over Screen Sharing):
   1. Open Terminal.
   2. Run `cd /Volumes/PresenceSSD/presence-app && git pull`.
   3. Run `~/.npm-global/bin/claude` (the Claude Code CLI the old lanes used; its path is recorded in the old repository's run logs).
   4. Paste: `From: Nami (owner). Read docs/handover/mac-session.md and execute it exactly as written. Step 1 and step 2 are already done (see docs/verification/setup-report.md).`
2. **For B1, have a runner token ready**: on github.com open `namidavoodzadeh/presence-app` → Settings → Actions → Runners → New self-hosted runner → macOS → ARM64. The page shows a one-time token used by the setup session; it expires after an hour, so open it only when the session asks.
3. **For B4**, branch protection on `main` needs your account's admin rights on the repository; the session will ask when it reaches B4.

Nothing in Part C was started. The old background services (`com.presence.supervisor`, `com.presence.watchdog`) were not touched.
