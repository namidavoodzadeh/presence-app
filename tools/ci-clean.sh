#!/usr/bin/env bash
# Start of every job: remove the previous job's build output and CI simulators, then enforce the disk budget.
# Build output lives on the internal disk (~/ci-build), so the runner service needs no access to external drives.
# The job fails here, with a plain message, when the internal disk has under 25 GB free.
set -eu
OUT="${CI_BUILD_ROOT:-$HOME/ci-build/ci}"
case "$OUT" in "$HOME"/ci-build/*) ;; *) echo "ci-clean: refusing to clean $OUT (build output must be under $HOME/ci-build)"; exit 1;; esac
rm -rf "$OUT"; mkdir -p "$OUT"
DEVELOPER_DIR="${XCODE_PATH:-/Applications/Xcode.app}/Contents/Developer" xcrun simctl list devices -j 2>/dev/null \
  | grep -oE '"name" : "presence-ci-[^"]*"' | cut -d'"' -f4 | while read -r d; do xcrun simctl delete "$d" || true; done
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
