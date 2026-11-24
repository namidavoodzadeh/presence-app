#!/usr/bin/env bash
# Fails if flow logic touches UI or networking, or if a screen calls the network directly.
# Usage: tools/lint-structure.sh [repo-root]
set -u
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
fail=0
FLOWS="$ROOT/app/Packages/Flows/Sources"
APP="$ROOT/app/App"
if [ -d "$FLOWS" ]; then
  hits=$(grep -rnE '^\s*(@testable\s+)?import\s+(SwiftUI|UIKit|AppKit|Combine)\b|URLSession|URLRequest' "$FLOWS" --include='*.swift' || true)
  if [ -n "$hits" ]; then
    echo "lint-structure: Flows must not import UI frameworks or use networking types. Move this code to app/App (UI) or behind a protocol the app implements (network):"
    echo "$hits"; fail=1
  fi
fi
if [ -d "$APP" ]; then
  hits=$(grep -rnE 'URLSession|URLRequest|\bimport\s+OpenAPIURLSession\b' "$APP" --include='*.swift' || true)
  if [ -n "$hits" ]; then
    echo "lint-structure: screens must not call the network. Call a Flows state machine, which uses the generated Contract client:"
    echo "$hits"; fail=1
  fi
fi
exit $fail
