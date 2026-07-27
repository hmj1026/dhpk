#!/usr/bin/env bash
# reconcile-resumed-review.sh — orchestrator-invoked: after a SendMessage-
# resumed reviewer returns a conclusive FINAL result, reconcile its sentinel
# via the doc-backed fallback contract.
# Usage: reconcile-resumed-review.sh <sentinel-name> [label]
#
# Sanctioned only when a matching resumed obligation was recorded first (via
# record-resumed-obligation.sh) and a fresh canonical review doc now
# postdates both the sentinel and the recorded baseline. An intermediate
# message, a missing/stale/foreign review doc, or a foreign/missing session
# identity leaves the sentinel and obligation armed (exit 1) rather than
# clearing on the strength of the message alone (design decisions 2, 8, 11).
# Idempotent with the native subagent-stop-verify.sh path and the Stop-time
# sweep: if the sentinel is already clear, this consumes the matching
# obligation without error (design decisions 3, 10).

set -o pipefail

NAME="${1:-}"
LABEL="${2:-resumed-reconcile}"

. "$(dirname "$0")/_lib/session-env.sh"
ROOT="$(dhpk_root)"
SESS="$(dhpk_sessions_dir "$ROOT")"
. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/learning-db.sh"
. "$(dirname "$0")/_lib/sentinel-clear-core.sh"
. "$(dirname "$0")/_lib/resumed-review-obligation.sh"

if [ -z "$NAME" ]; then
    echo "[$LABEL] ERROR: no sentinel name provided." >&2
    echo "[$LABEL] usage: reconcile-resumed-review.sh <sentinel-name> [label]" >&2
    exit 2
fi

SLOT=-1
for i in "${!SENTINEL_NAMES[@]}"; do
    if [ "$NAME" = "${SENTINEL_NAMES[$i]}" ]; then
        SLOT="$i"
        break
    fi
done
if [ "$SLOT" -lt 0 ]; then
    echo "[$LABEL] ERROR: unknown sentinel name '$NAME'" >&2
    echo "[$LABEL] known sentinels: ${SENTINEL_NAMES[*]}" >&2
    exit 2
fi

SID="$(dhpk_current_session_id)"
if [ -z "$SID" ]; then
    echo "[$LABEL] ERROR: no session identity available (CLAUDE_CODE_SESSION_ID unset) — cannot reconcile." >&2
    exit 2
fi

AGENT_BARE="${SENTINEL_AGENTS[$SLOT]##*:}"
if dhpk_resumed_reconcile_one "$ROOT" "$SESS" "$NAME" "$AGENT_BARE" "$SID" "$LABEL"; then
    exit 0
else
    echo "[$LABEL] $NAME left armed — no matching obligation or no fresh review doc yet." >&2
    exit 1
fi
