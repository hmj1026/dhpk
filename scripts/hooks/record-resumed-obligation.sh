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
. "$(dirname "$0")/_lib/review-lifecycle.sh"
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

LIFECYCLE_TASK=""
LIFECYCLE_ATTEMPT=""
LIFECYCLE_SCOPE=""
LIFECYCLE_DIFF=""
LIFECYCLE_SESSION=""
LIFECYCLE_PRODUCER=""
LIFECYCLE_WAVE=""
LIFECYCLE_EVIDENCE_SCOPE=""
LIFECYCLE_ADAPTER=""
LIFECYCLE_STAGE=""
LIFECYCLE_PLAN=""
LIFECYCLE_ARTIFACT=""
LIFECYCLE_ADAPTER_VERSION=""
LIFECYCLE_CONTEXT="$(dhpk_lifecycle_context "$AGENT_BARE" "$SID" 2>/dev/null || true)"
if [ -n "$LIFECYCLE_CONTEXT" ]; then
    IFS=$'\t' read -r LIFECYCLE_TASK LIFECYCLE_ATTEMPT LIFECYCLE_SCOPE LIFECYCLE_DIFF LIFECYCLE_SESSION \
        LIFECYCLE_PRODUCER LIFECYCLE_WAVE LIFECYCLE_EVIDENCE_SCOPE LIFECYCLE_ADAPTER LIFECYCLE_STAGE \
        LIFECYCLE_PLAN LIFECYCLE_ARTIFACT LIFECYCLE_ADAPTER_VERSION <<< "$LIFECYCLE_CONTEXT"
fi

# A resumed SendMessage has no new PreToolUse dispatch event to seed context.
# Bind it to a stable task identity derived from this owned sentinel/session,
# while retaining any richer producer context from the original lifecycle.
[ -n "$LIFECYCLE_TASK" ] || LIFECYCLE_TASK="$(dhpk_lifecycle_task_id "$NAME" "$SID" "0" 2>/dev/null || true)"
[ -n "$LIFECYCLE_PRODUCER" ] || LIFECYCLE_PRODUCER="$AGENT_BARE"
[ -n "$LIFECYCLE_WAVE" ] || LIFECYCLE_WAVE="resumed:${SID}:${NAME}"
[ -n "$LIFECYCLE_EVIDENCE_SCOPE" ] || LIFECYCLE_EVIDENCE_SCOPE="$(dhpk_lifecycle_scope_id "$SESS/$NAME" 2>/dev/null || true)"
[ -n "$LIFECYCLE_ADAPTER" ] || LIFECYCLE_ADAPTER="$AGENT_BARE"
[ -n "$LIFECYCLE_STAGE" ] || LIFECYCLE_STAGE="review"
[ -n "$LIFECYCLE_TASK" ] && [ -n "$LIFECYCLE_EVIDENCE_SCOPE" ] || {
    echo "[$LABEL] ERROR: lifecycle identity could not be derived — refusing legacy obligation." >&2
    exit 1
}

if dhpk_resumed_obligation_record "$SESS" "$NAME" "${SENTINEL_LABELS[$SLOT]}" "$AGENT_BARE" "$SID" "$BASELINE_NAME" "$BASELINE_MTIME" \
    "$LIFECYCLE_TASK" "$LIFECYCLE_PRODUCER" "$LIFECYCLE_WAVE" "$LIFECYCLE_EVIDENCE_SCOPE" "$LIFECYCLE_ADAPTER" "$LIFECYCLE_STAGE" \
    "$LIFECYCLE_PLAN" "$LIFECYCLE_ARTIFACT" "$LIFECYCLE_DIFF"; then
    echo "[$LABEL] resumed obligation recorded for $NAME (agent=$AGENT_BARE, baseline=${BASELINE_NAME:-none})"
    # The orchestrator must copy this exact envelope into the resumed
    # reviewer SendMessage. The reviewer then carries it into the new
    # canonical artifact frontmatter; reconciliation verifies the binding.
    RESUMED_RECORD="$(dhpk_resumed_obligation_lookup "$SESS" "$NAME" "$SID" 2>/dev/null || true)"
    RESUMED_ATTEMPT="$(printf '%s' "$RESUMED_RECORD" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); print(d.get("dispatch_attempt", d.get("attempt", "1")))' 2>/dev/null || printf '1')"
    RESUMED_DISPATCH="$(printf '%s' "$RESUMED_RECORD" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("dispatch_id", ""))' 2>/dev/null || true)"
    IDENTITY_ENVELOPE="task_id=$LIFECYCLE_TASK attempt_id=${LIFECYCLE_TASK}:attempt:$RESUMED_ATTEMPT session_id=$SID dispatch_attempt=$RESUMED_ATTEMPT"
    [ -n "$RESUMED_DISPATCH" ] && IDENTITY_ENVELOPE="$IDENTITY_ENVELOPE dispatch_id=$RESUMED_DISPATCH"
    IDENTITY_ENVELOPE="$IDENTITY_ENVELOPE producer=$LIFECYCLE_PRODUCER wave=$LIFECYCLE_WAVE scope_id=$LIFECYCLE_EVIDENCE_SCOPE adapter=$LIFECYCLE_ADAPTER stage=$LIFECYCLE_STAGE"
    [ -n "$LIFECYCLE_DIFF" ] && IDENTITY_ENVELOPE="$IDENTITY_ENVELOPE diff_id=$LIFECYCLE_DIFF"
    [ -n "$LIFECYCLE_PLAN" ] && IDENTITY_ENVELOPE="$IDENTITY_ENVELOPE plan_fingerprint=$LIFECYCLE_PLAN"
    [ -n "$LIFECYCLE_ARTIFACT" ] && IDENTITY_ENVELOPE="$IDENTITY_ENVELOPE artifact_fingerprint=$LIFECYCLE_ARTIFACT"
    printf 'RESUMED_REVIEW_IDENTITY %s\n' "$IDENTITY_ENVELOPE"
    exit 0
else
    echo "[$LABEL] ERROR: failed to record resumed obligation for $NAME (python3 missing?)" >&2
    exit 1
fi
