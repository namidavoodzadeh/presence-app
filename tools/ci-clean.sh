#!/usr/bin/env bash
# Start of every job: remove the previous job's build output and CI simulators, then enforce the disk budget.
# Build output lives on the internal disk (~/ci-build), so the runner service needs no access to external drives.
# The job fails here, with a plain message, when the internal disk has under 25 GB free.
set -eu
OUT="${CI_BUILD_ROOT:-$HOME/ci-build/ci}"
refuse() { echo "ci-clean: refusing to clean $OUT ($1)"; exit 1; }
# The path is resolved before anything is deleted: no "..", no symlink anywhere on the way, and the resolved path
# must be a folder strictly inside the real ~/ci-build.
case "/$OUT/" in */../*|*/./*) refuse "it contains . or .. components";; esac
case "$OUT" in "$HOME"/ci-build/?*) ;; *) refuse "build output must be under $HOME/ci-build";; esac
# Every part of the path that already exists is checked before anything is created or deleted.
p="$OUT"; while [ "$p" != "/" ] && [ "$p" != "$HOME" ]; do [ -L "$p" ] && refuse "$p is a symlink"; p="$(dirname "$p")"; done
mkdir -p "$OUT"
ROOT_REAL="$(cd "$HOME/ci-build" && pwd -P)"
OUT_REAL="$(cd "$OUT" && pwd -P)"
case "$OUT_REAL" in "$ROOT_REAL"/?*) ;; *) refuse "it resolves to $OUT_REAL, which is not inside $ROOT_REAL";; esac
rm -rf "$OUT_REAL"; mkdir -p "$OUT_REAL"
# Jobs run in parallel on several runners, but each runner runs one job at a time: a simulator named for this runner
# (tools/ci-sim.sh) is a leftover of this runner's earlier job and safe to delete. Other runners' simulators are never
# touched.
export DEVELOPER_DIR="${XCODE_PATH:-/Applications/Xcode.app}/Contents/Developer"   # list and delete with the same Xcode
xcrun simctl list devices -j 2>/dev/null \
  | python3 -I -c 'import json,sys
me=sys.argv[1]
for rt in json.load(sys.stdin).get("devices",{}).values():
    for d in rt:
        n=d.get("name","")
        # presence-ci-<runner>--<run id>: the runner part must equal this runner exactly.
        if n.startswith("presence-ci-") and "--" in n and n[len("presence-ci-"):].rsplit("--",1)[0]==me: print(d["udid"])' "${RUNNER_NAME:-local}" \
  | while read -r u; do xcrun simctl delete "$u" || true; done
MIN_FREE_GB=25
# CI_FREE_KB is for tools/selftest.sh only: it stands in for the measured free space.
free_kb="${CI_FREE_KB:-$(df -k "$HOME" | awk 'NR==2 {print $4}')}"
free_gb=$(( free_kb * 1024 / 1000000000 ))
if [ "$free_gb" -lt "$MIN_FREE_GB" ]; then
  msg="JOB COULD NOT RUN: the internal disk has ${free_gb} GB free and CI needs at least ${MIN_FREE_GB} GB. Free space on the Mac mini (empty the Trash, delete old simulators with 'xcrun simctl delete unavailable', clear ~/Library/Developer/Xcode/DerivedData), then re-run the job."
  echo "::error title=Job could not run::$msg"
  echo "$msg" >&2
  exit 4
fi
echo "ci-clean: $OUT emptied; ${free_gb} GB free on the internal disk (budget ${MIN_FREE_GB} GB)"
