#!/usr/bin/env bash
# Prints the changed files that match high_risk_paths in policy/merge-policy.yml.
# Usage: tools/high-risk-changed.sh <base-ref> [head-ref]   (exit 0 always; empty output = low risk)
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
base="$1"; head="${2:-HEAD}"
patterns="$(awk '/^high_risk_paths:/{f=1;next} f&&/^[^ ]/{f=0} f&&/^ *- /{sub(/^ *- */,"");sub(/ *#.*/,"");print}' "$ROOT/policy/merge-policy.yml")"
git -C "$ROOT" diff --name-only "$base...$head" | while read -r file; do
  while read -r p; do
    [ -n "$p" ] || continue
    glob="${p//\*\*/*}"
    # shellcheck disable=SC2254
    case "$file" in $glob) echo "$file"; break;; esac
  done <<< "$patterns"
done
