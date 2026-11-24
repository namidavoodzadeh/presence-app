# Presence app: map for agents

Kenember (code name Presence) is an iPhone app that helps people say hard things the way they mean them.
Write a message, get insight from what the app knows about you, send it at a chosen time.
The server and engine already exist; the iPhone app is being rebuilt screen by screen.

## Rules that always hold
- Work starts only from a tracker issue. No issue, no change.
- The twelve product laws in docs/THESIS-LAWS.md override everything. If a task would break one, stop and say so on the issue.
- Done means: a commit, and every check in `tools/` and CI green. A statement that work is done counts for nothing.
- Never edit an existing test, `policy/`, `.github/` or `contract/` unless the issue is labelled for that path. A hook enforces this.
- Fix the code, never the number: no padding, delay or allow-list entry to make a check pass.
- If the same item fails CI twice, stop. Report what the package or the item got wrong.
- A gap in a package is a package defect: take the simplest behaviour consistent with the package, and record it on the issue.

## Folder map
| Path | What it is | Who writes it |
| --- | --- | --- |
| `packages/NN/` | A frozen package: screens, flows, states, behaviour tables, copy, routes | Explore chat; frozen by the owner |
| `app/App/` | Screens only. No flow logic, no direct network calls | App builder |
| `app/Packages/Flows/` | Flow logic as state machines. No SwiftUI, UIKit or networking | App builder |
| `app/Packages/Contract/` | Swift client generated from `contract/openapi.yaml`. Never edited by hand | Generated |
| `app/Packages/DesignKit/` | Tokens and shared components. The only place for colours, sizes, spacing | App builder |
| `contract/openapi.yaml` | The one definition of what the server returns | Engine builder, high-risk path |
| `next/` | API (`next/api`) and engine (`next/engine`), TypeScript on Deno | Engine builder |
| `supabase/` | Database migrations and function config | Engine builder, high-risk path |
| `evals/bridge_offline/` | Offline engine evaluation and gold set | Engine builder; gold set owned by psychology advisor |
| `design/v3/` | Fonts, brand assets, links to the frozen V3 design | Read-only |
| `policy/merge-policy.yml` | Risk paths and merge rules | Owner decision |
| `tools/` | Lint and protection scripts | Factory, high-risk path |

## Commands
- Flow logic tests: `swift test --package-path app/Packages/Flows`
- Structure lint: `tools/lint-structure.sh`
- Token lint: `tools/lint-tokens.sh`
- Self-test of the tools: `tools/selftest.sh`
- Server tests: `cd next && deno task test`
- Offline engine evaluation: `deno run -A evals/bridge_offline/run.ts --variant <name>`

## App structure rules (checked by lint and compiler)
- Every screen that shows server data holds one `LoadState` value and switches over all four cases with no `default`.
- A save shows as saved only after the server confirms.
- Every control has a stable `accessibilityIdentifier` named `screen.control`.
- Colours, font sizes and spacing come from DesignKit. Hand-typed values fail the token lint.
- A bug fix adds a test that failed before the fix, at the lowest layer that reproduces the bug.

## Two tracks, one writer each
- App track: `app/`. Engine track: `next/`, `supabase/`, `evals/`. They meet only at `contract/openapi.yaml`.
- The old repository (`namidavoodzadeh/Presence`) is a read-only reference. Do not copy its app code wholesale.
