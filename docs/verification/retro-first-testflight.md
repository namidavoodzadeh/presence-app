# Retro: the first TestFlight build (26–27 Nov 2026)

What delayed the first build, the fix for each cause, and how to tell whether the fix held. Re-check this file after every release, and fill in the "Build 2" and "Build 3" columns. A fix that fails its check gets a new item, and this file links to it.

Tracking issue: #76.

## Baseline (build 1)

| Measure | Build 1 | Build 2 | Build 3 |
|---|---|---|---|
| First app PR ready to merge → build on TestFlight | ~21 h (not yet uploaded at the time of writing) | | |
| Of that, waiting on the owner | ~10 h | | |
| Owner round trips (Terminal steps, approvals) | 14 | | |
| Review rounds per risk-path PR (max) | 4 (#67) | | |
| PRs merged by owner bypass | 1 (#67) | | |
| Release runs failed before the first upload | 5 | | |

## Causes, fixes and checks

| # | Delay | Time lost | Root cause | Fix | Status | Check that proves it held |
|---|---|---|---|---|---|---|
| 1 | PRs could not merge, all "behind" | ~8 h | Branch protection had `strict: true`: every PR had to be rebased after each merge, and turning it off needed the owner | Owner set `strict=false` | Done 27 Nov | No PR waits in "behind" state; `gh api .../branches/main/protection/required_status_checks --jq .strict` is `false` |
| 2 | risk-review failed on every risk-path PR | ~10 h (overlaps 1) | Codex was not signed in under `~/.codex-review` on the Mac | Owner signed in; #74 adds a nightly and pre-release health check | Sign-in done; #74 open | Health check line "codex auth: ok" every night; no risk-review failure with "not signed in" |
| 3 | Release archive failed at CodeSign (`errSecInternalComponent`) | ~11 h (overnight) | The runner is a launchd agent and cannot use the login keychain. Unlock, partition list and a service restart did not help | Dedicated `ci-signing.keychain-db`, unlocked per job from `CI_KEYCHAIN_PASSWORD`, relocked always, 1 h auto-lock (#65, PR #67) | Done 27 Nov | Release step "Archive: success" on every run; no `errSecInternalComponent` in release logs |
| 4 | Release export/upload failed | open | API key cannot use cloud-managed distribution certificates; no App Store profile installed | Manual export with a profile fetched through the API, ported from the old repo's `testflight.sh` (#71) | In progress | Release step "Upload to TestFlight: success"; build visible in TestFlight within 30 min |
| 5 | Review findings never reached the builder | ~2 h + supervisor fixing by hand | A REQUEST_CHANGES review does not start builder round 2; re-adding `ready` restarts round 1, ignores comments, and fails at publish ("PR already exists") | #70: review findings start round 2; publish reuses an existing PR; stop after two rounds with one list for the owner | In progress (PR #72) | No supervisor commits on `item/*` branches; no build-item failure with "a pull request ... already exists" |
| 6 | Same owner-only objection over four rounds | ~1.5 h + one bypass merge | The reviewer judged a policy point (owner approval of a new secret) it cannot see, so it repeated it every round | #75: the gate handles owner-only items, posts them once, labels `needs-owner-merge`; the reviewer reviews only correctness and security | Open | Owner-only PRs get one comment and a normal owner merge; zero bypass merges |
| 7 | Contract PR #66 (#11) unreviewable | still blocked | 313k-character diff over the 180k review limit, mostly generated client code. Leaving the generated code out was rejected by the reviewer | Owner chose (a): review the diff in parts, all parts must approve (#68) | In progress (PR #73) | #66 gets a real review of every part and merges |
| 8 | Waiting for label approvals | ~1–2 h total | Every `path:` label needed an owner "yes" | Standing approval (owner, 27 Nov 07:41 PT): supervisor adds `path:` labels without asking; owner-only items still go to the owner | Done 27 Nov | Zero label requests to the owner |

## Pattern

Causes 2, 3 and 4 were prerequisites that nobody tested until real work reached them, hours later. #74 (health check) is the guard: if one of them breaks again, the health check reports it before a build depends on it.

## Supervisor lessons

- Propose the fastest path and the setup checks at the start, not after a delay.
- For a new failure, first look at how the old pipeline (namidavoodzadeh/Presence) solved it, before trying guesses. Cause 3 cost two extra owner round trips because this was skipped.
- Batch owner actions into one list. Notify the owner only when every dependency of the action is ready.

## Related open items

- #58 / PR #62 (engine on Linux, skip simulator): parked after two reviews found security design gaps. Revisit after #70 and #75.
