#!/usr/bin/env bash
# check-portability.sh — static portability gate for plugin shell scripts.
#
# Two passes over every shipped .sh file:
#   1. bash -n syntax check
#   2. grep for bash-4+/GNU-only idioms that break stock macOS (bash 3.2 +
#      BSD userland): declare -A, mapfile/readarray, ${var,,}/${var^^},
#      grep -P, date -d, readlink -f, sort -V, find -printf without a Darwin
#      branch nearby (heuristic: flagged for manual review).
#
# Exit non-zero when any file fails — wire into CI.

set -o pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

# Collect candidate scripts (POSIX find — no GNU extensions).
SCRIPTS="$(find "$PLUGIN_ROOT/scripts" "$PLUGIN_ROOT/modules" -type f -name '*.sh' 2>/dev/null)"
[ -z "$SCRIPTS" ] && { echo "[portability] no scripts found"; exit 1; }

SELF="$PLUGIN_ROOT/scripts/check-portability.sh"

while IFS= read -r f; do
    [ -z "$f" ] && continue
    # The checker carries the forbidden patterns as literal strings — skip self.
    [ "$f" = "$SELF" ] && continue

    if ! bash -n "$f" 2>/dev/null; then
        echo "[portability] SYNTAX FAIL: $f" >&2
        bash -n "$f" 2>&1 | head -3 >&2
        fail=1
    fi

    # bash-4-only / GNU-only idioms. Comments are stripped first so prose
    # mentions (like this header) don't trip the gate.
    stripped="$(sed 's/[[:space:]]*#.*$//' "$f")"
    for pattern in 'declare -A' 'mapfile' 'readarray' 'grep -P' 'grep -[a-zA-Z]*P[a-zA-Z]* ' 'date -d ' 'readlink -f' 'sort -V'; do
        if printf '%s' "$stripped" | grep -q -- "$pattern"; then
            # 'date -d' is fine as the GNU-first attempt when a BSD 'date -j'
            # fallback exists in the same file.
            if [ "$pattern" = 'date -d ' ] && printf '%s' "$stripped" | grep -q -- 'date -j'; then
                continue
            fi
            echo "[portability] NON-PORTABLE IDIOM '$pattern' in: $f" >&2
            fail=1
        fi
    done
    # ${var,,} / ${var^^} case conversion (bash 4+).
    if printf '%s' "$stripped" | grep -Eq '\$\{[A-Za-z_][A-Za-z0-9_]*(,,|\^\^)\}'; then
        echo "[portability] NON-PORTABLE IDIOM '\${var,,}/\${var^^}' in: $f" >&2
        fail=1
    fi
    # find -printf needs a Darwin branch (stat -f) in the same file.
    if printf '%s' "$stripped" | grep -q -- '-printf'; then
        if ! grep -q "Darwin" "$f"; then
            echo "[portability] 'find -printf' without a Darwin branch in: $f" >&2
            fail=1
        fi
    fi
done <<EOF_SCRIPTS
$SCRIPTS
EOF_SCRIPTS

if [ "$fail" -eq 0 ]; then
    echo "[portability] OK: all shipped scripts pass syntax + portability checks"
fi
exit "$fail"
