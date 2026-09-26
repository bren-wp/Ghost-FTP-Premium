#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TAURI_DIR="$ROOT/ghostftp-desktop/src-tauri"

cd "$TAURI_DIR"

cargo generate-lockfile

# Tauri 2.11.5+ currently publishes menu plugin code that is incompatible with
# its own Error enum, while unconstrained transitive ranges can also pull 2.12
# runtime/macros/utils into a 2.11 core. Lock the last coherent upstream set.
cargo update -p tauri --precise 2.11.4
cargo update -p tauri-runtime --precise 2.11.3
cargo update -p tauri-runtime-wry --precise 2.11.4
cargo update -p tauri-macros --precise 2.6.3
cargo update -p tauri-utils --precise 2.9.3
cargo update -p tauri-codegen --precise 2.6.3
cargo update -p tauri-build --precise 2.6.3

check_locked() {
  local package="$1"
  local expected="$2"
  local actual
  actual="$(awk -v pkg="$package" '
    $0 == "name = \"" pkg "\"" { found=1; next }
    found && /^version = / { gsub(/version = |"/, ""); print; exit }
  ' Cargo.lock)"
  if [[ "$actual" != "$expected" ]]; then
    echo "Cargo.lock mismatch for $package: expected $expected, got ${actual:-missing}" >&2
    exit 1
  fi
}

check_locked tauri 2.11.4
check_locked tauri-runtime 2.11.3
check_locked tauri-runtime-wry 2.11.4
check_locked tauri-macros 2.6.3
check_locked tauri-utils 2.9.3
check_locked tauri-codegen 2.6.3
check_locked tauri-build 2.6.3

cargo metadata --locked --format-version 1 >/dev/null

echo "Canonical Cargo.lock generated and verified."
