# Setup tasks

A task is done only when its check passes on a machine. Record each result in `docs/verification/`.
Full reasoning: https://claude.ai/artifact/PgqkTaWJQTxQvQ3vvfHdo7 (setup) and https://claude.ai/artifact/LGiRefNTpzih4si3kis53d (system design).

## Part A, remaining (on the Mac)
| Id | Do | Check |
| --- | --- | --- |
| A2c | In `next/`, run `deno task test` | Passes. Record the test count. Compare with the same command in the old repository at `f507c92`; the counts match |
| A4 | Create the Xcode project in `app/` (app target = `app/App`, screens only) with local packages `Flows` (exists), `Contract`, `DesignKit`. Bundle id stays `com.namidavoodzadeh.presence` | `swift test --package-path app/Packages/Flows` passes with no simulator running. `tools/selftest.sh` passes |
| A5 | `DesignKit`: colours teal `#173E40`, cream `#FFF2DE`, apricot `#F2B18D`; fonts from `design/v3/fonts`; a spacing scale; text styles that scale with the system text size | Adding `.padding(13)` to a file in `app/App` makes `tools/lint-tokens.sh` exit non-zero |
| A6 | Add one template screen in `app/App` that switches over all four `LoadState` cases with no `default` | Removing one case from that switch fails the build |
| A7 | Fill `contract/openapi.yaml` with the routes named in `packages/01/routes.md` (when it exists). Add a server test validating each listed route's real response against the file. Generate the Swift client into `Contract` with Apple's Swift OpenAPI Generator | Renaming one field in the file fails both the server test and the app build |

## Part B: the factory (on the Mac)
| Id | Do | Check |
| --- | --- | --- |
| B1 | Register this Mac as one self-hosted GitHub Actions runner for `namidavoodzadeh/presence-app`, label `mac-mini`, installed as a service. One shared concurrency group across all workflows. Build output on `/Volumes/PresenceSSD`, cleaned at the start of each job | Two pushes one minute apart run one after the other. Free disk after ten runs is within 5 GB of the start |
| B2 | Pin one Xcode path and one simulator runtime in every workflow; first step fails with a plain message if either is missing | A wrong Xcode path fails in the first step with that message |
| B3 | `ci.yml`. Fast stage: `tools/selftest.sh`, both lints, `Flows` tests, server tests, contract validation. Simulator stage: build, snapshot tests, accessibility audit, journey set with permissions granted through `xcrun simctl privacy` | A change to a `Flows` file gets a fast-stage result with no simulator booted. A 2-point change to a spacing token fails a snapshot |
| B4 | Enforce `policy/merge-policy.yml`: protect `main`, require `ci.yml`, merge automatically when green; paths under `high_risk_paths` also require a review job run by a different model family | A green low-risk change merges with no human action. A change under `supabase/migrations/` waits for the review job |
| B5 | `build-item.yml`: an issue labelled `ready` starts one Claude Code session for that issue on the runner, one at a time per track. After a second red CI round it labels the issue `returned` and stops | A test issue labelled `ready` produces a change unaided. An issue built to fail gets `returned` after exactly two rounds |
| B6 | `engine-eval.yml`: on changes under `next/engine/` or `evals/bridge_offline/`, run the offline evaluation, post the four numbers, fail if any is worse than `main` | A prompt change shows the four numbers; a deliberately worse variant fails |
| B7 | `release.yml`: on a merge to `main` touching `app/`, archive and upload to the TestFlight Owner group with the App Store Connect key already on this Mac | A merged app change reaches TestFlight for the owner with no command typed |

## Part C: first cycle
| Id | Do | Check |
| --- | --- | --- |
| C1 | Explore chat writes `packages/01/` per `packages/README.md` and `packages/01/SCOPE.md` | `tools/check-package.sh 01` exits zero (script to be written with C1) |
| C2 | Owner freezes package 01 | `packages/01/FROZEN.md` records the owner's yes |
| C3 | Cut package 01 into issues, one screen or one route each | Every screen and route maps to exactly one issue |
| C4 | Test author writes acceptance tests per issue before any code, without seeing an implementation | Each issue links tests that fail because the code does not exist |

## Rules for whoever runs these
- Do not copy anything from the old factory (`queue/`, `scripts/`, `ops/` in the old repository).
- Secrets stay on the Mac and in GitHub Actions secrets. Never print one, never commit one.
- Anything needing the owner (a sign-in, a system setting, spending) is listed once, at the end, with exact steps verified on this Mac. Do not ask him piecemeal.
- Old background services (`com.presence.supervisor`, `com.presence.watchdog`) are retired only on the owner's word, after B1 to B7 pass.
