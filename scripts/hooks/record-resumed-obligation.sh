#!/usr/bin/env bash
# record-resumed-obligation.sh — orchestrator-invoked: record a resumed-review
# obligation BEFORE resuming a pending reviewer through SendMessage.
# Usage: record-resumed-obligation.sh <sentinel-name> [label]
#
# Part of the fix-resumed-review-sentinel-clearance fallback contract: this
# captures the review-doc baseline (the latest matching canonical review
# doc, if any, BEFORE the resume) and this session's identity, so the
# later reconcile-resumed-review.sh call can prove a NEW doc was written
# during the resume and that only the recording session can clear it (design
# decisions 1, 8, 11). This is not a new reviewer dispatch and does not touch
# the sentinel or any active-liveness marker.

set -o pipefail

NAME="${1:-}"
LABEL="${2:-resumed-obligation}"

. "$(dirname "$0")/_lib/session-env.sh"
ROOT="$(dhpk_root)"
SESS="$(dhpk_sessions_dir "$ROOT")"
. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/resumed-review-obligation.sh"

if [ -z "$NAME" ]; then
    echo "[$LABEL] ERROR: no sentinel name provided — cannot record which slot is being resumed." >&2
    echo "[$LABEL] usage: record-resumed-obligation.sh <sentinel-name> [label]" >&2
    echo "[$LABEL] known sentinels: ${SENTINEL_NAMES[*]}" >&2
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

if [ ! -f "$SESS/$NAME" ]; then
    echo "[$LABEL] ERROR: $NAME is not armed — nothing to resume." >&2
    exit 2
fi

SID="$(dhpk_current_session_id)"
if [ -z "$SID" ]; then
    echo "[$LABEL] ERROR: no session identity available (CLAUDE_CODE_SESSION_ID unset) — cannot record ownership." >&2
    exit 2
fi

AGENT_BARE="${SENTINEL_AGENTS[$SLOT]##*:}"
REVIEWS_DIR="$ROOT/.claude/artifacts/reviews"
BASELINE_PATH="$(ls -t "$REVIEWS_DIR/$AGENT_BARE"-*.md 2>/dev/null | head -1 || true)"
BASELINE_NAME=""
BASELINE_MTIME="0"
if [ -n "$BASELINE_PATH" ]; then
    BASELINE_NAME="$(basename "$BASELINE_PATH")"
    BASELINE_MTIME="$(stat -c %Y "$BASELINE_PATH" 2>/dev/null || stat -f %m "$BASELINE_PATH" 2>/dev/null || echo 0)"
fi

if dhpk_resumed_obligation_record "$SESS" "$NAME" "${SENTINEL_LABELS[$SLOT]}" "$AGENT_BARE" "$SID" "$BASELINE_NAME" "$BASELINE_MTIME"; then
    echo "[$LABEL] resumed obligation recorded for $NAME (agent=$AGENT_BARE, baseline=${BASELINE_NAME:-none})"
    exit 0
else
    echo "[$LABEL] ERROR: failed to record resumed obligation for $NAME (python3 missing?)" >&2
    exit 1
fi
