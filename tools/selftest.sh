#!/usr/bin/env bash
# Proves each tool fails when it should. Run in CI before the tools are trusted.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; T="$(mktemp -d)"; pass=0; failn=0
unset BUILD_CACHE   # the cases below set it themselves; CI sets it for the real jobs
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
printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"}}' "$ROOT/next/tests/brand_new_test.ts" | PROTECT_BASE=refs/no/such/base "$ROOT/tools/protect-tests.sh" >/dev/null 2>&1
[ $? -eq 2 ] && ok "protect: test edit blocked when the base is missing" || no "protect: test edit blocked when the base is missing"
clean(){ mkdir -p "$T/home"; HOME="$T/home" CI_BUILD_ROOT="${2:-$T/home/ci-build/ci}" XCODE_PATH="$T/no-xcode" CI_FREE_KB="$1" "$ROOT/tools/ci-clean.sh" >"$T/clean.out" 2>&1; }
clean 30000000; [ $? -eq 0 ] && ok "ci-clean: 30 GB free passes" || no "ci-clean: 30 GB free passes"
clean 20000000; [ $? -eq 4 ] && grep -q "JOB COULD NOT RUN" "$T/clean.out" && ok "ci-clean: 20 GB free fails with a plain message" || no "ci-clean: 20 GB free fails with a plain message"
clean 30000000 "/tmp/elsewhere"; [ $? -eq 1 ] && ok "ci-clean: refuses to clean outside ~/ci-build" || no "ci-clean: refuses to clean outside ~/ci-build"
mkdir -p "$T/keep"; touch "$T/keep/precious"
clean 30000000 "$T/home/ci-build/../../keep"; [ $? -eq 1 ] && [ -e "$T/keep/precious" ] && ok "ci-clean: refuses a path with .." || no "ci-clean: refuses a path with .."
ln -s "$T/keep" "$T/home/ci-build/link"
clean 30000000 "$T/home/ci-build/link"; [ $? -eq 1 ] && [ -e "$T/keep/precious" ] && ok "ci-clean: refuses a symlink out of ~/ci-build" || no "ci-clean: refuses a symlink out of ~/ci-build"
clean 30000000 "$T/home/ci-build/link/sub"; [ $? -eq 1 ] && [ -e "$T/keep/precious" ] && [ ! -e "$T/keep/sub" ] && ok "ci-clean: refuses a symlinked ancestor and creates nothing" || no "ci-clean: refuses a symlinked ancestor and creates nothing"
cache(){ HOME="$T/home" CI_BUILD_ROOT="$T/home/ci-build/ci" XCODE_PATH="$T/no-xcode" XCODE_VERSION="${3:-27.2}" BUILD_CACHE="$2" CI_FREE_KB="$1" "$ROOT/tools/ci-clean.sh" >"$T/clean.out" 2>&1; }
C="$T/home/ci-build/cache"; mkdir -p "$C/xcode-27.2/dd" "$C/xcode-26.0/dd"; touch "$C/xcode-27.2/dd/kept" "$T/home/ci-build/ci/gone"
cache 30000000 "$C/xcode-27.2"; [ $? -eq 0 ] && [ -e "$C/xcode-27.2/dd/kept" ] && [ ! -e "$C/xcode-26.0" ] && [ ! -e "$T/home/ci-build/ci/gone" ] \
  && ok "ci-clean: keeps the cache of the pinned Xcode, removes other versions and build output" || no "ci-clean: keeps the cache of the pinned Xcode, removes other versions and build output"
cache 30000000 "$C/xcode-26.0"; [ $? -eq 1 ] && [ -e "$C/xcode-27.2/dd/kept" ] && ok "ci-clean: refuses a cache not keyed by the pinned Xcode" || no "ci-clean: refuses a cache not keyed by the pinned Xcode"
cache 30000000 "$T/keep"; [ $? -eq 1 ] && [ -e "$T/keep/precious" ] && ok "ci-clean: refuses a cache outside ~/ci-build/cache" || no "ci-clean: refuses a cache outside ~/ci-build/cache"
mkdir -p "$T/home/ci-build/eval-cache"; touch "$T/home/ci-build/eval-cache/reply"
cache 20000000 "$C/xcode-27.2"; [ $? -eq 4 ] && [ ! -e "$C" ] && [ -e "$T/home/ci-build/eval-cache/reply" ] && grep -q "removed the build cache" "$T/clean.out" \
  && ok "ci-clean: removes the build cache when the disk is under budget" || no "ci-clean: removes the build cache when the disk is under budget"
rm -rf "$T"; echo "$pass passed, $failn failed"; [ "$failn" -eq 0 ]
