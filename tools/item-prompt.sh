#!/usr/bin/env bash
# Builds the prompt for one builder session. Usage: tools/item-prompt.sh <issue-number> <round> [failure-log-file]
set -eu
n="$1"; round="$2"; log="${3:-}"
issue="$(gh issue view "$n" --json title,body,labels --jq '"# Issue #\(.number // "'"$n"'"): \(.title)\n\nLabels: \([.labels[].name] | join(", "))\n\n\(.body)"')"
cat <<EOP
You are the builder for one tracker issue in this repository. Read AGENTS.md first and follow it exactly.
Work only on this issue. Do not touch files outside what it needs. Never edit existing tests, policy/, .github/
or contract/ unless the issue is labelled for that path. Fix the code, never the number.
Before you finish, run every check AGENTS.md lists that your change affects, and make them pass.
Do not commit or push; the workflow does that. If the issue is not buildable as written (a package gap you cannot
resolve with the simplest behaviour consistent with the package), write the reason to ITEM_BLOCKED.md and stop.

This is CI round $round of at most 2.

$issue
EOP
if [ -n "$log" ] && [ -s "$log" ]; then
  echo; echo "## Round 1 failed in CI. Failing log (last 300 lines):"; echo; echo '```'; tail -300 "$log"; echo '```'
fi
