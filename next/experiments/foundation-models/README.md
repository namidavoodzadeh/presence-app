# Apple Foundation Models experiments

`psy-v1-run.swift` and `psy-v1-fixtures.json` are the pro-8 PSY-v1 parser comparison. They run
three fictional long-form answers through Apple's on-device model, compare every extracted item
with a literal parser matching R14's five groups, and record context-window use and latency.

Supports `outputs/engine/FOUNDATION-MODELS.md` (COO 2026-10-31 11:25 Tehran, item 3, due Fri 6 Nov).
Nothing here touches `ios/` or `app/`. Nothing here has run against a real Apple Foundation Models
session: that needs Xcode plus a physical iPhone 15 Pro/16/17 or a macOS 26+ Simulator with Apple
Intelligence turned on, neither of which this worktree can reach. See
`outputs/engine/QUESTIONS.md` Q76.

## What's here

- `cases.json` — the test cases, pulled at $0 from already-paid data: 3 Talk-listener turns from
  `next/reports/20261027T072112Z-talk-full` (fictional personas, `evals/personas/exemplars.json`)
  and 2 cases from `engine/safety/eval_cases.json` (synthetic phrases, not real words). Each entry
  carries the Claude-path input/output/cost/latency already measured, and an `applePath.status:
  "not run"` placeholder for a future device-capable run to fill in.
- `listener_schema.swift` — the Talk listener's JSON contract
  (`next/engine/talk/prompts/turn.md`) translated into a `@Generable` struct, so a future run can
  drop it into a Swift package without re-deriving the schema from the prose prompt.
- `safety_schema.swift` — the safety-screen classification translated the same way: a 3-value
  `Risk` enum (`none|self|others`) plus a reason string, matching `next/engine/safety.ts`'s
  `RiskResult`.

## How to finish this once a device is reachable

1. A macOS 26.3+ Xcode project (outside this worktree — this plan does not touch `ios/`) that
   imports `FoundationModels`, builds a `LanguageModelSession` with `listener_schema.swift`'s
   `Generable` type as the response schema, and feeds it the same system prompt text as
   `next/engine/talk/prompts/turn.md` plus one case's `personText` from `cases.json`.
2. Record per case: wall-clock latency, `session.transcript` token counts (there is no raw
   `usage` block on-device — see the report's cost section), whether the call threw
   `LanguageModelError.guardrailViolation` or `.refusal`, and the parsed reply.
3. Fill `applePath` in `cases.json` with those fields and diff the reply against the same
   pass/fail checks `next/engine/talk/checks.ts` already runs on the Claude side (or the keyword
   floor in `next/engine/safety.ts` for the safety cases).
4. For Private Cloud Compute specifically: it needs the `com.apple.developer.private-cloud-compute`
   entitlement, which Apple grants only to App Store Small Business Program members under 2M
   downloads (see the report). A PCC run cannot happen from a developer account that isn't
   enrolled, independent of the Xcode/device blocker.

## Known mismatch found without running anything

The on-device model's context window is fixed at 4096 tokens total (prompt + history + reply;
Apple technote TN3193). The Claude-path `turn` calls in `cases.json` already show 2,575–11,607
input tokens by mid-conversation (`next/reports/20261027T072112Z-talk-full/usage.md`), because the
listener prompt repeats the full context package and session-so-far on every turn. An unmodified
port of the Talk listener would exceed the on-device budget by turn 2–3 of most conversations; it
would need real context compaction (trim or summarize `session.turns`), not just a schema port.
The safety screen's single-sentence classification stays well under 4096 tokens for the life of the
feature, so it is the more realistic on-device candidate of the two.
