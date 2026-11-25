# Handover: setup task C4 (tests before code) and two factory changes

From: Nami (owner), prepared by the setup chat on 25 Nov 2026.

Run on the Mac mini, in `/Volumes/PresenceSSD/presence-app` (pull `main` first). Read `AGENTS.md`, `packages/01/` and `docs/verification/C3.md`.

## Part 1: C4, acceptance tests per issue

You are the test author. You write tests from the frozen package only. You never write product code, and you never read an implementation of the thing you are testing.

For each issue below, in this order: #11, #8, #3, #6, #7, #12, #20, #18, then #13 to #17 and #19, then #4, #5, #9, #10.
1. Read the issue and the package files it links.
2. Write the tests it lists under "Acceptance tests". For a flow: one test per row of the state table, plus the shared rules in `flows/README.md`. The tests define the names and shapes the builder must provide; choose them once, plainly, and record them in a short "API the tests expect" note at the top of the test file.
3. Prove each test file is sound before committing it:
   - Swift: it must parse (`swiftc -parse`), and it must fail to build only because the product types do not exist yet. Put not-yet-buildable test files where they do not break `main` (a `Pending/` folder excluded from the package target, with a one-line note in the issue saying to move it in as the first step of the build).
   - Deno: `deno check` passes for the test file's own code, and the test fails for the stated reason, not for a typo.
4. Open one pull request per issue containing only tests, titled `tests: #<n>`, and link it on the issue.

Do NOT write tests for the screen issues (#21 to #34) yet. A screen's snapshot tests are written after its flow issue has merged, and still before the screen's code.

Stop rule: if a package file is ambiguous for a test, do not guess twice. Write the question on the issue, label it `blocked`, and move on.

## Part 2: two factory changes (replace the "Needs Nami" items 1 and 3.4 in `docs/verification/setup-report.md`)

1. **No Full Disk Access.** Do not ask the owner to grant disk access to a shell. Move the runner and its build output to the internal disk (`~/actions-runner`, build root under `~/ci-build`), with `tools/ci-clean.sh` at the start of every job and a hard budget: the job fails first, with a plain message, if free space is under 25 GB. Update the workflows' `CI_BUILD_ROOT`. Then run the B1 to B3 checks and record them in `docs/verification/part-B.md`.
2. **Second-model review without new spending.** Replace the API-based review in `tools/review-other-family.py` with the Codex CLI already installed on this Mac (the owner's existing plan). Same inputs and outputs; no `REVIEW_API_*` variables.
3. Set the three App Store Connect variables yourself from the key file already on this Mac (`ASC_KEY_PATH`, `ASC_KEY_ID`, `ASC_ISSUER_ID`) if `gh` is signed in here. They are identifiers and a path, not secret values. Never print the key.

## Report

Update `docs/verification/setup-report.md`: one line per issue (tests written, blocked, why), the B1 to B3 results, and a rewritten "Needs Nami" list that contains only what truly needs him, each with steps you have verified on this Mac.
