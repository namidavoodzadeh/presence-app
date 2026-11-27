#!/usr/bin/env bash
# Start of every job: remove the previous job's build output and CI simulators, then enforce the disk budget.
# Build output lives on the internal disk (~/ci-build), so the runner service needs no access to external drives.
# The job fails here, with a plain message, when the internal disk has under 25 GB free.
# BUILD_CACHE (optional; Xcode DerivedData, SwiftPM scratch folders) is kept between jobs. It must be
# ~/ci-build/cache/xcode-<XCODE_VERSION>, so a new Xcode starts from an empty cache; caches of other Xcode versions are
# removed here. When the disk is under budget, the whole cache is removed before the job is failed.
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
DEVELOPER_DIR="${XCODE_PATH:-/Applications/Xcode.app}/Contents/Developer" xcrun simctl list devices -j 2>/dev/null \
  | grep -oE '"name" : "presence-ci-[^"]*"' | cut -d'"' -f4 | while read -r d; do xcrun simctl delete "$d" || true; done
CACHE_ROOT="$HOME/ci-build/cache"
if [ -n "${BUILD_CACHE:-}" ]; then
  [ -n "${XCODE_VERSION:-}" ] || refuse "BUILD_CACHE is set but XCODE_VERSION is not"
  [ "$BUILD_CACHE" = "$CACHE_ROOT/xcode-$XCODE_VERSION" ] \
    || refuse "BUILD_CACHE must be $CACHE_ROOT/xcode-$XCODE_VERSION (keyed by the pinned Xcode), not $BUILD_CACHE"
  p="$BUILD_CACHE"; while [ "$p" != "/" ] && [ "$p" != "$HOME" ]; do [ -L "$p" ] && refuse "$p is a symlink"; p="$(dirname "$p")"; done
  mkdir -p "$BUILD_CACHE"
  for old in "$CACHE_ROOT"/*; do
    [ -e "$old" ] && [ "$old" != "$BUILD_CACHE" ] && { rm -rf "$old"; echo "ci-clean: removed cache $old (not Xcode $XCODE_VERSION)"; }
  done
fi
MIN_FREE_GB=25
# CI_FREE_KB is for tools/selftest.sh only: it stands in for the measured free space.
measure() { free_kb="${CI_FREE_KB:-$(df -k "$HOME" | awk 'NR==2 {print $4}')}"; free_gb=$(( free_kb * 1024 / 1000000000 )); }
measure
if [ "$free_gb" -lt "$MIN_FREE_GB" ] && [ -d "$CACHE_ROOT" ] && [ ! -L "$CACHE_ROOT" ]; then
  rm -rf "$CACHE_ROOT"; echo "ci-clean: disk under budget, removed the build cache $CACHE_ROOT"; measure
fi
if [ "$free_gb" -lt "$MIN_FREE_GB" ]; then
  msg="JOB COULD NOT RUN: the internal disk has ${free_gb} GB free and CI needs at least ${MIN_FREE_GB} GB. Free space on the Mac mini (empty the Trash, delete old simulators with 'xcrun simctl delete unavailable', clear ~/Library/Developer/Xcode/DerivedData), then re-run the job."
  echo "::error title=Job could not run::$msg"
  echo "$msg" >&2
  exit 4
fi
echo "ci-clean: $OUT emptied${BUILD_CACHE:+, cache $BUILD_CACHE kept}; ${free_gb} GB free on the internal disk (budget ${MIN_FREE_GB} GB)"
