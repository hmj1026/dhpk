#!/usr/bin/env bash
# clear-sentinel.sh — parametric sentinel cleaner.
# Usage: clear-sentinel.sh <sentinel-name|--all> [agent-label]
#
# Called by a review-agent's Closing hook to dismiss the matching
# stop-review-reminder entry. Fails fast on unknown sentinel names so a
# misnamed call doesn't silently pass while the sentinel still exists.

set -o pipefail

NAME="${1:-}"
LABEL="${2:-agent}"
# Canonical root via _lib/session-env.sh (CLAUDE_PROJECT_DIR-first) — the same
# resolution as every hook caller, so subagent-stop-verify.sh can delegate the
# clear without re-deriving the path itself.
. "$(dirname "$0")/_lib/session-env.sh"
ROOT="$(dhpk_root)"
SESS="$(dhpk_sessions_dir "$ROOT")"

# Known sentinel whitelist derived from _lib/payload.sh (SSOT). Extending
# SENTINEL_NAMES there is enough; this script needs no change.
# load-project-config.sh first so learning-db enablement honours project
# settings even when invoked as a plain Bash command (not a hook env).
. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/learning-db.sh"
readonly KNOWN_SENTINELS=("${SENTINEL_NAMES[@]}")

# Fail-loud front door (D3.2): a stale/partial reviewer payload that resolves to
# an EMPTY sentinel name must not exit 0 (or a terse bash `:?` error) having done
# nothing — it exits non-zero with an explicit message, mirroring the unknown-name
# path below. This is the "ownership cannot be determined" case from the
# sentinel-reliability spec; it EXTENDS (does not replace) the unknown-name exit 2.
if [ -z "$NAME" ]; then
    echo "[$LABEL] ERROR: no sentinel name provided — cannot determine which sentinel to clear (stale/partial payload?)." >&2
    echo "[$LABEL] usage: clear-sentinel.sh <sentinel-name|--all> [agent-label]" >&2
    echo "[$LABEL] known sentinels: ${KNOWN_SENTINELS[*]}" >&2
    exit 2
fi

if [ "$NAME" = "--all" ]; then
    cleared=0
    for s in "${KNOWN_SENTINELS[@]}"; do
        f="$SESS/$s"
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

SENTINEL="$SESS/$NAME"

if [ -f "$SENTINEL" ]; then
    rm -f "$SENTINEL"
    echo "[$LABEL] sentinel cleared ($NAME)"
    ldb_record success "review:$NAME" "$LABEL"
else
    echo "[$LABEL] sentinel already clean ($NAME)"
fi

exit 0
