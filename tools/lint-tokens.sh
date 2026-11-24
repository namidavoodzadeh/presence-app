#!/usr/bin/env bash
# Fails on hand-typed spacing, font sizes or colours outside DesignKit.
# Usage: tools/lint-tokens.sh [repo-root]
set -u
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
APP="$ROOT/app/App"
[ -d "$APP" ] || exit 0
pat='\.padding\(\s*(\.[a-zA-Z]+\s*,\s*)?[0-9]|spacing:\s*[0-9]|\.font\(\s*\.system\(\s*size:|\.frame\([^)]*:\s*[0-9]+(\.[0-9]+)?\s*[,)]|cornerRadius[:(]\s*[0-9]|Color\(\s*(red:|\.sRGB|hex:|#)|UIColor\(\s*red:'
hits=$(grep -rnE "$pat" "$APP" --include='*.swift' || true)
if [ -n "$hits" ]; then
  echo "lint-tokens: hand-typed size, spacing or colour. Use a DesignKit token (add one in app/Packages/DesignKit if the package needs it):"
  echo "$hits"; exit 1
fi
exit 0
