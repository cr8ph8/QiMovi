#!/usr/bin/env bash
set -euo pipefail
QI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
QI_CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/qimovi-clapper-check.XXXXXX")"
trap 'rm -rf "$QI_CHECK_DIR"' EXIT
swiftc -parse-as-library -target "$(uname -m)-apple-macos14.0" -module-cache-path "$QI_CHECK_DIR/cache" \
  "$QI_ROOT/iphone/QiMovi/ProductionModels.swift" \
  "$QI_ROOT/iphone/QiMovi/ClapperStore.swift" \
  "$QI_ROOT/iphone/tests/ClapperCheck.swift" -o "$QI_CHECK_DIR/check"
"$QI_CHECK_DIR/check"
