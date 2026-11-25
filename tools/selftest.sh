#!/usr/bin/env bash
# Proves each tool fails when it should. Run in CI before the tools are trusted.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; T="$(mktemp -d)"; pass=0; failn=0
ok(){ echo "PASS $1"; pass=$((pass+1)); }; no(){ echo "FAIL $1"; failn=$((failn+1)); }
mk(){ rm -rf "$T/r"; mkdir -p "$T/r/app/Packages/Flows/Sources/Flows" "$T/r/app/App"; }
mk; echo 'import Foundation' > "$T/r/app/Packages/Flows/Sources/Flows/A.swift"; echo 'import SwiftUI' > "$T/r/app/App/S.swift"
"$ROOT/tools/lint-structure.sh" "$T/r" >/dev/null && ok "structure: clean tree passes" || no "structure: clean tree passes"
echo 'import SwiftUI' >> "$T/r/app/Packages/Flows/Sources/Flows/A.swift"
"$ROOT/tools/lint-structure.sh" "$T/r" >/dev/null && no "structure: SwiftUI in Flows fails" || ok "structure: SwiftUI in Flows fails"
mk; echo 'let s = URLSession.shared' > "$T/r/app/App/S.swift"
"$ROOT/tools/lint-structure.sh" "$T/r" >/dev/null && no "structure: network in screen fails" || ok "structure: network in screen fails"
mk; echo 'Text("a").padding(Space.m)' > "$T/r/app/App/S.swift"
"$ROOT/tools/lint-tokens.sh" "$T/r" >/dev/null && ok "tokens: token use passes" || no "tokens: token use passes"
for bad in 'Text("a").padding(13)' 'Text("a").padding(.top, 8)' 'Text("a").font(.system(size: 17))' 'Color(red: 0.1, green: 0.2, blue: 0.3)' 'VStack(spacing: 12) {}'; do
  mk; echo "$bad" > "$T/r/app/App/S.swift"
  "$ROOT/tools/lint-tokens.sh" "$T/r" >/dev/null && no "tokens: rejects $bad" || ok "tokens: rejects $bad"
done
hook(){ printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"}}' "$1" | PROTECT_BASE=HEAD PROTECT_ALLOW="${2:-}" "$ROOT/tools/protect-tests.sh" >/dev/null 2>&1; }
existing="$(git -C "$ROOT" ls-tree -r --name-only HEAD 2>/dev/null | grep -E '_test\.ts$' | head -1)"
if [ -n "$existing" ]; then
  hook "$ROOT/$existing"; [ $? -eq 2 ] && ok "protect: existing test blocked" || no "protect: existing test blocked"
else echo "SKIP protect: no committed test yet"; fi
hook "$ROOT/next/tests/brand_new_test.ts"; [ $? -eq 0 ] && ok "protect: new test allowed" || no "protect: new test allowed"
hook "$ROOT/policy/merge-policy.yml"; [ $? -eq 2 ] && ok "protect: policy blocked" || no "protect: policy blocked"
hook "$ROOT/policy/merge-policy.yml" "policy/"; [ $? -eq 0 ] && ok "protect: policy allowed with label" || no "protect: policy allowed with label"
hook "$ROOT/app/App/Screen.swift"; [ $? -eq 0 ] && ok "protect: screen code allowed" || no "protect: screen code allowed"
clean(){ mkdir -p "$T/home"; HOME="$T/home" CI_BUILD_ROOT="${2:-$T/home/ci-build/ci}" XCODE_PATH="$T/no-xcode" CI_FREE_KB="$1" "$ROOT/tools/ci-clean.sh" >"$T/clean.out" 2>&1; }
clean 30000000; [ $? -eq 0 ] && ok "ci-clean: 30 GB free passes" || no "ci-clean: 30 GB free passes"
clean 20000000; [ $? -eq 4 ] && grep -q "JOB COULD NOT RUN" "$T/clean.out" && ok "ci-clean: 20 GB free fails with a plain message" || no "ci-clean: 20 GB free fails with a plain message"
clean 30000000 "/tmp/elsewhere"; [ $? -eq 1 ] && ok "ci-clean: refuses to clean outside ~/ci-build" || no "ci-clean: refuses to clean outside ~/ci-build"
rm -rf "$T"; echo "$pass passed, $failn failed"; [ "$failn" -eq 0 ]
