# Setup report, Mac mini session, 25 Nov 2026

Executed from `docs/handover/test-author.md` by a Claude Code session on the Mac mini (macOS 27.2, Xcode 27.2, Swift 6.4.2, Deno 2.9.8, Codex CLI 0.167.0). The 24 Nov report is in this file's git history. Details: `part-B.md` (top section), the pull requests named below, and a comment on each issue.

**Result: C4 done for all 18 issues in the list. 15 are ready for their builder; 3 wait on one owner question each (labelled `blocked`). Part B now runs on the runner: B1, B2 and B3 pass on real runs. Two factory changes are in PR #43, which is not merged yet.**

## Part 1: C4, acceptance tests per issue

Every test PR contains only tests. Tests that cannot pass before their code sit in a pending folder outside the build (`next/tests/pending/`, excluded from `deno task test`; `app/Packages/*/Tests/Pending/`, outside the test targets), so `main` stays green. The first build step of each issue is a `git mv` of its file into the real test folder. Each file starts with "API the tests expect". Soundness was checked as the handover says: every Swift file parses, fails to build only for the missing product types, and compiles and runs against a signatures-only stub (not committed). Every Deno file passes `deno check` and fails only for the missing behaviour. Hosted probes were also run against a local stub, once passing and once failing.

| Issue | Tests | Result | One line |
| --- | --- | --- | --- |
| #11 contract | PR #35 | written | routes.md ⇔ `openapi.yaml` check, and each route run through its real handler, validated, with a rename-a-field check; the builder supplies `contract_scenarios.ts` |
| #8 AI consent and gate | PR #36 | written | give, withdraw, version moved on; zero model calls without consent on 9 model routes, with a check that each scenario does reach the model when consent is given; no other route calls a model |
| #3 comm engine on hosted | PR #37 | written | hosted probe: a listed account gets 2xx on the three routes, an unlisted one `feature_off`/`owner_only`. Which "three safety probes" are meant is open, recorded on the issue |
| #6 Keep on hosted | PR #38 | written | hosted probe: send, open, keep; `GET /cards` shows kept for both. Gap: thread items carry no card state (also affects #31) |
| #7 Google sign-in on hosted | PR #39 | written | hosted probe: no session without `adult_confirmed: true`, wrong nonce 401, unverified email 401, a session otherwise |
| #12 privacy page | PR #40 | written | served page names Anthropic and Claude, what is sent and not, Settings; no contradicting sentence |
| #20 DesignKit tokens | PR #41 | **blocked** | every token in `tokens.md` (18 tests). Question: `rowLine` is 300 at 14.5 pt, but the same file says nothing under 16 pt uses 200 or 300 |
| #18 write and send | PR #42 | **blocked** | 55 tests, one per row of all three tables plus the shared rules; defines the shared Flows types. Question: is a vague_ask highlight a note (copy.md) or not (the flow table)? |
| #13 sign in | PR #45 | written | 33 tests, rows 01–26 and the shared rules |
| #14 AI consent and Settings | PR #47 | written | 36 tests in two machines, one per table |
| #15 Talk | PR #50 | written | 56 tests, all 48 rows and the shared rules |
| #16 You and a kenning | PR #51 | written | 22 tests, all 18 rows |
| #17 Someone new and the invited person | PR #46 | written | 56 tests over three machines (People, Someone new, Invited) |
| #19 push, card, reading, Keep | PR #49 | **blocked** | 32 tests. Question: a push for this person reloads the thread "from any state", but nothing may move while someone reads; what happens during a reading? |
| #4 strength on a kept item | PR #44 | written | partly, very, none, bad value; 2 fail today for the missing field |
| #5 invite gift | PR #48 | written | 9 tests; read and accept run the real database functions on PGlite with every migration |
| #9 kinds without encryption | PR #52 | written | Talk never offers What lands hard or This week; fails today (This week is offered in a second session) |
| #10 belief routes on comm items | PR #53 | written | 4 tests, **all pass today**: both "Engine to confirm" rows work on the fake database. What is left is the same calls on staging, where row-level security applies |

Each issue's gaps (simplest behaviour taken) are in its comment. No tests were written for the screen issues (#21 to #34), as the handover says.

## Part 2: factory changes (PR #43)

| Change | Result | One line |
| --- | --- | --- |
| No Full Disk Access | done | Runner copied to `~/actions-runner` and its service reinstalled from there (online as `mac-mini`). Build output in `~/ci-build/ci`, eval cache in `~/ci-build/eval-cache`. `tools/ci-clean.sh` runs at the start of every job and fails it with a plain message under 25 GB free. The old copy on the drive is left in place, with no service |
| Codex review | done | `tools/review-other-family.py` runs the signed-in Codex CLI. Same input and output; no `REVIEW_API_*`. Checked here: it rejects a diff that disables the protect hook and approves a comment-only diff |
| One concurrency group per workflow and branch | done | With the runner online, the shared `mac-mini` group cancelled every CI run: each issue label or comment queued a `build-item` run that took the group's only pending slot. This is the fallback `part-B.md` had already recorded |
| App Store Connect variables | not done | Finding the key file on disk was refused by this session's safety check, as it was on 24 Nov. Steps in "Needs Nami" |

| Task | Result | One line (details in `part-B.md`) |
| --- | --- | --- |
| B1 | pass | Runner online from the internal disk. Two runs dispatched one minute apart ran strictly one job at a time. Ten runs in a row: all 10 green; free space 39.9 GB at the start, 36.9 GB after the tenth (3.0 GB used, within the 5 GB allowance) |
| B2 | pass | A run with `XCODE_PATH=/Applications/Xcode-wrong.app` failed in its first step: `JOB COULD NOT RUN: Pinned Xcode not found at /Applications/Xcode-wrong.app…`, also shown as a "Job could not run" annotation |
| B3 | pass | A Flows-file change got its fast result in 1 m 42 s with no simulator booted, and the simulator stage passed. `Space.m` 16→18 failed the `template-loaded` snapshot ("differs from reference") and also the DesignKit 4-point grid test |

B4 to B7 were not part of this handover and are unchanged (they still need the secrets below).

## Needs Nami

Only what this session could not do. Each item says what was checked on this Mac.

1. **Give the terminal back its access to the external drive.** Partway through this session, macOS started refusing this session any access to `/Volumes/PresenceSSD`: `ls /Volumes/PresenceSSD` gives `Operation not permitted` (the drive is still mounted). It started after an old CI run from 24 Nov, still using the external path, hung in `mkdir /Volumes/PresenceSSD/build/ci`, most likely on a macOS permission prompt. That run was then cancelled at its timeout. The work went on from a clone on the internal disk (`~/presence-report`). Checked: the denial and the mount. Not checked: the fix, because only you can change it. System Settings → Privacy & Security → Files and Folders → the terminal app you run Claude Code in → turn **Removable Volumes** on. If a prompt about the runner asks for access to removable volumes, choose **Don't Allow**: the runner no longer needs it.
2. **Answer three questions.** They are on #18, #19 and #20, each with lettered options. Reply on the issue; the next session adds the missing assertion and removes `blocked`.
3. **Merge PR #43** once its checks are green. It changes `.github/` and `tools/`, so `risk-review` runs the new Codex review on it. Until it merges, `main`'s workflows still point at the external drive and every run on `main` fails at "Clean build output". After it merges, re-run the test PRs' CI from the Actions tab.
4. **App Store Connect variables (B7).** The key file's name has the key ID: `AuthKey_<KEY_ID>.p8`. In Terminal:
   `gh variable set ASC_KEY_PATH -R namidavoodzadeh/presence-app --body "<full path of the .p8 file>"`, then the same for `ASC_KEY_ID` (from the file name) and `ASC_ISSUER_ID` (App Store Connect → Users and Access → Integrations). Checked: `gh` is signed in here with `repo` and `workflow` scope; the repository has no variables yet.
5. **Secrets (B4 auto-merge, B5).** Checked: the repository has no secrets yet. `FACTORY_TOKEN`: github.com/settings/personal-access-tokens/new → fine-grained, only `presence-app`, Contents, Issues, Pull requests and Workflows read and write, then `gh secret set FACTORY_TOKEN -R namidavoodzadeh/presence-app`. `CLAUDE_CODE_OAUTH_TOKEN`: run `~/.npm-global/bin/claude setup-token`, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN -R namidavoodzadeh/presence-app`.
6. **Stop App Store app updates (B2).** Checked: `/Library/Preferences/com.apple.commerce AutoUpdate` is `1`. App Store → Settings → switch off Automatic Updates.
7. **Repository visibility.** Checked: `namidavoodzadeh/presence-app` is still public, with a runner on this Mac. Fork runs are skipped and outside contributors need approval. To make it private: Settings → General → Danger Zone → Change visibility. Protecting `main` on a private repository needs a paid GitHub plan.
8. **Disk headroom.** Checked: the internal disk has between 31 and 39 GB free during this session, against a 25 GB budget. Simulators alone use 17 GB (`~/Library/Developer/CoreSimulator`). If jobs start failing on the budget, run `xcrun simctl delete unavailable` and empty the Trash.

## Factory notes for the next session
- `tools/protect-tests.sh` refuses every file written by an agent in a git worktree under `.claude/worktrees/`: it matches the path as `.claude/*`. The agents wrote new test files through the scratchpad and `cp`. Fix it with an issue labelled for `tools/`.
- Protect `main` (B4) once PR #43 is merged and CI has gone green on `main`: the command is in `part-B.md`.
- GitHub's API failed often today (GraphQL errors, 500s and 502s on push, PR and label calls). Every PR, comment and label was checked afterwards. The `blocked` labels had silently not applied and were added again through REST.
