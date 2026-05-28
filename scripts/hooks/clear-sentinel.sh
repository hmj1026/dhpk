#!/usr/bin/env bash
# clear-sentinel.sh — parametric sentinel cleaner.
# Usage: clear-sentinel.sh <sentinel-name|--all> [agent-label]
#
# Called by a review-agent's Closing hook to dismiss the matching
# stop-review-reminder entry. Fails fast on unknown sentinel names so a
# misnamed call doesn't silently pass while the sentinel still exists.

set -o pipefail

NAME="${1:?usage: clear-sentinel.sh <sentinel-name|--all> [agent-label]}"
LABEL="${2:-agent}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Known sentinel whitelist derived from _lib/payload.sh (SSOT). Extending
# SENTINEL_NAMES there is enough; this script needs no change.
# load-project-config.sh first so learning-db enablement honours project
# settings even when invoked as a plain Bash command (not a hook env).
. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/learning-db.sh"
readonly KNOWN_SENTINELS=("${SENTINEL_NAMES[@]}")

if [ "$NAME" = "--all" ]; then
    cleared=0
    for s in "${KNOWN_SENTINELS[@]}"; do
        f="$ROOT/.claude/artifacts/sessions/$s"
        if [ -f "$f" ]; then
            rm -f "$f"
            echo "[$LABEL] sentinel cleared ($s)"
            ldb_record success "review:$s" "$LABEL"
            cleared=$((cleared + 1))
        fi
    done
    [ "$cleared" -eq 0 ] && echo "[$LABEL] no sentinels to clear"
    exit 0
fi

is_known=false
for s in "${KNOWN_SENTINELS[@]}"; do
    if [ "$NAME" = "$s" ]; then
        is_known=true
        break
    fi
done

if [ "$is_known" != true ]; then
    echo "[$LABEL] ERROR: unknown sentinel name '$NAME'" >&2
    echo "[$LABEL] known sentinels: ${KNOWN_SENTINELS[*]}" >&2
    echo "[$LABEL] hint: agent's Closing hook should pass the exact sentinel file basename" >&2
    exit 2
fi

SENTINEL="$ROOT/.claude/artifacts/sessions/$NAME"

if [ -f "$SENTINEL" ]; then
    rm -f "$SENTINEL"
    echo "[$LABEL] sentinel cleared ($NAME)"
    ldb_record success "review:$NAME" "$LABEL"
else
    echo "[$LABEL] sentinel already clean ($NAME)"
fi

exit 0
