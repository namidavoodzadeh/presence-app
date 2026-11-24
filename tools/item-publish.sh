#!/usr/bin/env bash
# Commits the builder's work on item/<n>, pushes, and opens the PR on round 1. Usage: tools/item-publish.sh <n> <round>
set -eu
n="$1"; round="$2"
git config user.name "presence-factory"; git config user.email "factory@users.noreply.github.com"
if [ -f ITEM_BLOCKED.md ]; then
  gh issue comment "$n" --body-file ITEM_BLOCKED.md
  gh issue edit "$n" --add-label returned --remove-label ready
  echo "builder stopped: ITEM_BLOCKED.md"; exit 0
fi
git add -A
if git diff --cached --quiet; then
  gh issue comment "$n" --body "Round $round produced no change."
  gh issue edit "$n" --add-label returned --remove-label ready
  exit 0
fi
git commit -qm "Item #$n, round $round"
git push -f -u origin "item/$n"
if [ "$round" = 1 ]; then
  title="$(gh issue view "$n" --json title --jq .title)"
  gh pr create --base main --head "item/$n" --title "$title" --body "Closes #$n. Built by build-item.yml, round 1."
fi
