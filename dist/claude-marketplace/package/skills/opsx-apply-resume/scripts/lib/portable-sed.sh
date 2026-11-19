#!/usr/bin/env bash
# portable-sed.sh — cross-platform `sed -i` wrapper (Linux/WSL GNU sed vs macOS BSD sed).
# Source-only — do not execute directly.
#
# Usage:
#   . "$(dirname "$0")/_lib/portable-sed.sh"
#   sed_inplace 's/foo/bar/' path/to/file
#
# Rationale: GNU sed needs `sed -i`, BSD sed needs `sed -i ''`. Centralizing the
# OS detect here keeps the plugin portable across WSL / Linux / macOS dev hosts.

sed_inplace() {
    if [ "$(uname)" = "Darwin" ]; then
        sed -i '' "$@"
    else
        sed -i "$@"
    fi
}
