#!/usr/bin/env bash
# Regenerates Sources/Contract/Generated from contract/openapi.yaml with Apple's Swift OpenAPI Generator.
# CI runs this before building the app, so a change to openapi.yaml reaches the app build.
# Usage: app/Packages/Contract/generate.sh [--check]   (--check fails if the committed files are stale)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="$HERE/Sources/Contract/Generated"
swift run -q --package-path "$HERE/generator" --scratch-path "${CONTRACT_GEN_BUILD:-$HERE/generator/.build}" -c release \
  swift-openapi-generator generate "$ROOT/contract/openapi.yaml" \
  --config "$HERE/generator/openapi-generator-config.yaml" --output-directory "$OUT" >/dev/null
if [ "${1:-}" = "--check" ]; then
  git -C "$ROOT" diff --quiet -- "$OUT" || { echo "contract: Generated client is stale. Run app/Packages/Contract/generate.sh and commit."; exit 1; }
fi
