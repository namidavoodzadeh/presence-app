#!/usr/bin/env bash
# First step of every workflow. Checks the pinned toolchain before anything else runs.
# Exits 3 with a plain message when the job cannot run on this machine (not a test failure).
# Env: XCODE_PATH (e.g. /Applications/Xcode.app), XCODE_VERSION (e.g. 27.2), SIM_RUNTIME (simctl runtime identifier).
set -u
cant_run() { echo "::error title=Job could not run::$1"; echo "JOB COULD NOT RUN: $1"; exit 3; }
[ -n "${XCODE_PATH:-}" ] || cant_run "XCODE_PATH is not set in the workflow."
[ -d "$XCODE_PATH/Contents/Developer" ] || cant_run "Pinned Xcode not found at $XCODE_PATH. Install it there or change XCODE_PATH in the workflow."
version="$(DEVELOPER_DIR="$XCODE_PATH/Contents/Developer" xcodebuild -version 2>/dev/null | awk 'NR==1{print $2}')"
[ "$version" = "${XCODE_VERSION:-$version}" ] || cant_run "Xcode at $XCODE_PATH is $version; the workflow pins ${XCODE_VERSION}."
if [ "${NEEDS_SIMULATOR:-1}" = 1 ]; then
  [ -n "${SIM_RUNTIME:-}" ] || cant_run "SIM_RUNTIME is not set in the workflow."
  DEVELOPER_DIR="$XCODE_PATH/Contents/Developer" xcrun simctl list runtimes -j 2>/dev/null \
    | grep -q "\"identifier\" : \"$SIM_RUNTIME\"" || cant_run "Pinned simulator runtime $SIM_RUNTIME is not installed for $XCODE_PATH."
fi
echo "toolchain ok: Xcode $version at $XCODE_PATH${SIM_RUNTIME:+, runtime $SIM_RUNTIME}"
