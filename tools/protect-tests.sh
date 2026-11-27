#!/usr/bin/env bash
# Claude Code PreToolUse hook. Reads the tool call as JSON on stdin.
# Exit 2 blocks the edit and shows the message to the agent.
# Blocks: edits to test files that already exist on origin/main, and any edit under protected paths.
# PROTECT_ALLOW (set by CI only for an issue labelled for that path) is a colon-separated list of path prefixes to allow.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
input="$(cat)"
file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)"
[ -n "$file" ] || exit 0
case "$file" in /*) rel="${file#"$ROOT"/}" ;; *) rel="$file" ;; esac
allowed() { local IFS=:; for p in ${PROTECT_ALLOW:-}; do [ -n "$p" ] && case "$rel" in "$p"*) return 0;; esac; done; return 1; }
allowed && exit 0
case "$rel" in
  policy/*|.github/*|contract/*|tools/*|.claude/*)
    echo "protect: $rel is a protected path. It changes only through an issue labelled for it." >&2; exit 2;;
esac
is_test=0
case "$rel" in
  */Tests/*|*/tests/*|*Tests.swift|*_test.ts|*.test.ts|*/__Snapshots__/*|evals/*/drafts*|evals/*/judge_calibration*) is_test=1;;
esac
if [ "$is_test" = 1 ]; then
  base="${PROTECT_BASE:-origin/main}"
  # Fail closed: on a fresh checkout without the base (a GitHub-hosted runner), no test edit is allowed.
  if ! git -C "$ROOT" rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
    echo "protect: cannot tell whether $rel is an existing test: $base is not in this checkout. Fetch main first." >&2; exit 2
  fi
  if git -C "$ROOT" cat-file -e "$base:$rel" 2>/dev/null; then
    echo "protect: $rel is an existing test. Fix the code, not the test. If the test is wrong, say so on the issue and stop." >&2; exit 2
  fi
fi
exit 0
