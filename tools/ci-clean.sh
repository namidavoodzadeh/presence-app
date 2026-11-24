#!/usr/bin/env bash
# Start of every job: remove the previous job's build output on the external drive.
set -eu
OUT="${CI_BUILD_ROOT:-/Volumes/PresenceSSD/build/ci}"
case "$OUT" in /Volumes/PresenceSSD/build/*) ;; *) echo "ci-clean: refusing to clean $OUT"; exit 1;; esac
rm -rf "$OUT"; mkdir -p "$OUT"
DEVELOPER_DIR="${XCODE_PATH:-/Applications/Xcode.app}/Contents/Developer" xcrun simctl list devices -j 2>/dev/null \
  | grep -oE '"name" : "presence-ci-[^"]*"' | cut -d'"' -f4 | while read -r d; do xcrun simctl delete "$d" || true; done
df -h /Volumes/PresenceSSD | tail -1
