#!/usr/bin/env bash
# Creates and boots a fresh simulator on the pinned runtime, grants the journey permissions, prints its UDID.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
name="presence-ci-${GITHUB_RUN_ID:-local}"
udid="$(xcrun simctl create "$name" "${SIM_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17}" "$SIM_RUNTIME")"
xcrun simctl boot "$udid" >&2
xcrun simctl bootstatus "$udid" -b >/dev/null
grep -vE '^\s*(#|$)' "$ROOT/app/Tests/UI/permissions.txt" | while read -r service; do
  xcrun simctl privacy "$udid" grant "$service" com.namidavoodzadeh.presence >&2
done
echo "$udid"
