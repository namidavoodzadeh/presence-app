#!/usr/bin/env bash
# Red rounds of one item branch. A round is one pushed commit; it is red when its CI run (pull_request) failed or
# risk-review requested changes on it (merge.yml run whose "Changes requested" step ran). A commit red on both counts
# once. Usage:
#   tools/item-reds.sh count <branch>            prints the number of distinct red commits
#   tools/item-reds.sh is-red <run-id>           exit 0 when that ci or merge run marks its commit red
#   tools/item-reds.sh log <branch> <sha> <file> writes the failure logs of every red run on <sha> to <file>
set -eu
mode="$1"

# Prints "<run-id> <sha> <workflow>" for each red run on the branch.
red_runs(){
  gh run list --workflow ci.yml --branch "$1" --event pull_request --limit 50 --json databaseId,headSha,conclusion \
    --jq '.[] | select(.conclusion == "failure") | "\(.databaseId) \(.headSha) ci"'
  gh run list --workflow merge.yml --branch "$1" --event pull_request_target --limit 50 \
    --json databaseId,headSha,conclusion --jq '.[] | select(.conclusion == "failure") | "\(.databaseId) \(.headSha)"' |
  while read -r id sha; do
    is_review_red "$id" && echo "$id $sha merge"
  done
}
is_review_red(){
  [ "$(gh run view "$1" --json jobs --jq '[.jobs[].steps[] | select(.name == "Changes requested" and .conclusion == "success")] | length')" -gt 0 ]
}

case "$mode" in
  count)
    red_runs "$2" | awk '{print $2}' | sort -u | wc -l | tr -d ' ' ;;
  is-red)
    wf="$(gh run view "$2" --json workflowName,conclusion --jq '"\(.workflowName) \(.conclusion)"')"
    case "$wf" in
      "ci failure") exit 0 ;;
      "merge failure") is_review_red "$2" ;;
      *) exit 1 ;;
    esac ;;
  log)
    branch="$2"; sha="$3"; out="$4"; : > "$out"
    red_runs "$branch" | while read -r id s wf; do
      [ "$s" = "$sha" ] || continue
      if [ "$wf" = merge ]; then echo "### risk-review requested changes (run $id)"; else echo "### CI failed (run $id)"; fi
      gh run view "$id" --log-failed | tail -300 || true
      echo
    done >> "$out" ;;
  *) echo "usage: tools/item-reds.sh count <branch> | is-red <run-id> | log <branch> <sha> <file>" >&2; exit 64 ;;
esac
