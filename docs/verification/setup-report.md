# Setup report, Mac mini session, 24 Nov 2026

Executed from `docs/handover/mac-session.md` by a Claude Code session running on the Mac mini (macOS 27.2, Xcode 27.2, Swift 6.4.2, Deno 2.9.8). Steps 1 and 2 were done by the earlier session (see git history of this file). Details: `part-A-mac.md`, `part-B.md`.

**Result: Part A passes (A7 waits for package 01). Part B is written and locally exercised but blocked: the runner cannot read the external drive until the owner allows it in System Settings.**

## Tasks

| Task | Result | One line |
| --- | --- | --- |
| A2c | pass | `deno task test` 978 passed, old repository at `f507c92` 978 passed (after copying two safety data files A2 missed) |
| A4 | pass | `app/Presence.xcodeproj` from `app/project.yml`; Flows tests pass with no simulator; `tools/selftest.sh` 14/0 |
| A5 | pass | DesignKit colours, spacing, fonts, Dynamic Type styles; `.padding(13)` makes `lint-tokens.sh` exit 1 |
| A6 | pass | `TemplateScreen` over all four `LoadState` cases; removing one fails the build |
| A7 | blocked | `packages/01/routes.md` does not exist (written in Part C). Generator pipeline is in place (`app/Packages/Contract/generate.sh`) |
| B1 | blocked | Runner registered and installed as a service; macOS blocks background agents from `/Volumes/PresenceSSD` (two attempts, `Operation not permitted`) |
| B2 | blocked | Needs B1. Preflight verified locally: a wrong Xcode path fails in the first step with a plain message |
| B3 | blocked | Needs B1. Verified locally: fast stage without a simulator; a 2-point spacing token change fails a snapshot |
| B4 | blocked | Needs B1 and B3; also a review model and `FACTORY_TOKEN` from the owner. High-risk path matching verified locally |
| B5 | blocked | Needs B1 and B3, `FACTORY_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` |
| B6 | blocked | Needs B1. Comparison verified on existing runs: four worse variants fail, baseline passes |
| B7 | blocked | Needs B1 and the App Store Connect key location |

Nothing in Part C was started. The old background services (`com.presence.supervisor`, `com.presence.offsite`) were not touched. `PROTECT_ALLOW` was not needed: files under `.github/` and `tools/` were written from the shell, which the edit hook does not watch, as the handover allows for this setup.

## Needs Nami

1. **Let the runner read the external drive (unblocks B1, then B2–B7).** Verified: the cause is macOS privacy protection on removable volumes. Not verified: that this exact grant is enough, because only you can make it.
   1. System Settings → Privacy & Security → Full Disk Access → **+** → press Cmd+Shift+G, type `/bin/bash`, Open, and switch it on. The runner service is a bash script (`runsvc.sh`) on the drive; everything it starts inherits the grant. Trade-off: any background bash job on this Mac gets disk access. The narrower alternative is to move the runner to the internal disk, which breaks "build output on the external drive".
   2. Then tell the next session "runner access granted". It runs `cd /Volumes/PresenceSSD/actions-runner && ./svc.sh start`, confirms `mac-mini` shows online, and runs the B1–B7 checks.
2. **Repository visibility.** The setup document says A1 is a *private* repository; `namidavoodzadeh/presence-app` is **public**, with a runner that runs code on this Mac. Mitigated now: fork jobs are skipped and runs from outside contributors need approval. To make it private: github.com → `namidavoodzadeh/presence-app` → Settings → General → Danger Zone → Change visibility → Make private. Check first: protecting `main` on a private repository needs a paid GitHub plan (Pro or Team); on GitHub Free, B4 is only possible on a public repository. I could not read your plan with the current token.
3. **Secrets and variables** (github.com → the repository → Settings → Secrets and variables → Actions, or the `gh` commands shown; values are pasted when prompted, never typed into a chat):
   1. `FACTORY_TOKEN`: github.com/settings/personal-access-tokens/new → fine-grained, only `presence-app`, permissions Contents, Issues, Pull requests and Workflows set to read and write. Then `gh secret set FACTORY_TOKEN -R namidavoodzadeh/presence-app`. Needed because merges and PRs made with the built-in token do not start other workflows.
   2. `CLAUDE_CODE_OAUTH_TOKEN` (B5): in Terminal on the Mac run `~/.npm-global/bin/claude setup-token` (verified present in Claude Code 2.1.331), sign in, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN -R namidavoodzadeh/presence-app`.
   3. App Store Connect key (B7): `gh variable set ASC_KEY_PATH -R namidavoodzadeh/presence-app --body "<full path of the AuthKey_….p8 file on this Mac>"`, and the same for `ASC_KEY_ID` and `ASC_ISSUER_ID` (App Store Connect → Users and Access → Integrations). The file stays where it is. In App Store Connect, make sure the TestFlight internal group "Owner" has automatic distribution on, so new builds reach it.
   4. Review by a different model family (B4, new spending): choose a provider. Then `gh variable set REVIEW_API_URL` (an OpenAI-compatible chat completions URL), `gh variable set REVIEW_MODEL`, `gh secret set REVIEW_API_KEY`. Until then, high-risk changes wait, which is the policy.
4. **Stop automatic app updates (B2)** so Xcode does not move under the pin. Verified on this Mac: automatic macOS installs are already off, but App Store app updates are on (`com.apple.commerce AutoUpdate = 1`). App Store → Settings → switch off Automatic Updates.
5. **After 1–3, protecting `main` (B4)** is one command the next session runs once CI has gone green once:
   `gh api -X PUT repos/namidavoodzadeh/presence-app/branches/main/protection --input -` with `{"required_status_checks":{"strict":true,"checks":[{"context":"fast"},{"context":"simulator"},{"context":"risk-review"}]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}`.

Note: the workflows pushed with this report queue a `ci` run that waits for the runner. GitHub cancels queued jobs after 24 hours. If that happens, rerun it from the Actions tab once the runner is online.
