#!/usr/bin/env bash
# Commits the builder's work on item/<n>, pushes, and opens the PR unless one is already open. Usage: tools/item-publish.sh <n> <round>
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
# The push updates an open PR for the branch (a later round, or round 1 re-run after `ready` was added again);
# a PR is opened only when none is open.
pr="$(gh pr list --head "item/$n" --base main --state open --json number --jq '.[0].number // empty')"
if [ -n "$pr" ]; then
  gh pr comment "$pr" --body "Round $round pushed to item/$n by build-item.yml."
else
  title="$(gh issue view "$n" --json title --jq .title)"
  gh pr create --base main --head "item/$n" --title "$title" --body "Closes #$n. Built by build-item.yml, round $round."
fi
