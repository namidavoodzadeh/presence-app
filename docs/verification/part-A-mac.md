# Part A verification on the Mac mini, 24 Nov 2026

Machine: Mac mini (arm64), macOS 27.2, Xcode 27.2 (27B52), Swift 6.4.2, Deno 2.9.8. Run from a Claude Code session on the Mac.

| Task | Result | Evidence |
| --- | --- | --- |
| A2c | pass | `cd next && deno task test`: **978 passed, 0 failed**. Old repository at `f507c92` (extracted with `git archive`, old checkout untouched), same command: **978 passed, 0 failed**. Per-file counts identical. First run here had 949 + 1 failed: `next/tests/safety_test.ts` reads `engine/safety/eval_set.json` and `eval_cases.json` from the repository root, which the A2 copy missed. Both data files copied from `f507c92` (package gap, recorded here) |
| A4 | pass | `app/project.yml` → `app/Presence.xcodeproj` (XcodeGen 2.48.0; regenerate with `cd app && xcodegen generate`). Target `Presence`, bundle id `com.namidavoodzadeh.presence`, sources = `app/App` (synced folder), local packages `Flows`, `Contract`, `DesignKit`. `xcodebuild … build` for iOS Simulator: BUILD SUCCEEDED. `swift test --package-path app/Packages/Flows` with 0 simulators booted: 4 tests, 0 failures. `tools/selftest.sh`: 14 passed, 0 failed |
| A5 | pass | `DesignKit`: `Palette.teal/cream/apricot` (`#173E40`, `#FFF2DE`, `#F2B18D`), `Space` scale 2–48 on a 4-pt grid, `Radius`, the four V3 fonts bundled and registered, `TextStyle` fonts built with `relativeTo:` so they follow the system text size. `swift test` in DesignKit: 3 tests pass (colours, scale, fonts register by name). Check: `.padding(Space.m)` → `.padding(13)` in `app/App/Screens/TemplateScreen.swift` makes `tools/lint-tokens.sh` exit 1; reverted |
| A6 | pass | `app/App/Screens/TemplateScreen.swift` switches over `loading`, `empty`, `failed`, `loaded` with no `default`. Check: removing the `.empty` case fails the build with `error: switch must be exhaustive`; reverted |
| A7 | see `setup-report.md` | |

## Decisions taken in A4 (package gaps, simplest behaviour)
- **Contract client is generated ahead of time, not by the Xcode build plugin.** Xcode refuses to run an untrusted package plugin from the command line, and turning that check off was not acceptable. `app/Packages/Contract/generate.sh` runs Apple's Swift OpenAPI Generator 1.9.0 (pinned in `app/Packages/Contract/generator/`) and writes `Sources/Contract/Generated/{Types,Client}.swift`. Those files are never edited by hand. CI runs `generate.sh` before building the app, so a change to `contract/openapi.yaml` still reaches the app build; `generate.sh --check` fails if the committed files are stale.
- `LoadState.from` rewritten as `extension LoadState where Value: Collection` to clear a Swift 6 error-in-waiting; tests unchanged and passing.
- App deployment target iOS 17.0, matching the packages. Team `UK39PYVJ96`, automatic signing, as in the old project.
