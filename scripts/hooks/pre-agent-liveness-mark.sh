#!/usr/bin/env bash
# pre-agent-liveness-mark.sh — PreToolUse (Task|Agent) hook
#
# Records that a known reviewer subagent has been dispatched. Stop-time
# reminders use this liveness marker to distinguish "reviewer still running"
# from "review never dispatched / already finished".

set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh"
. "$(dirname "$0")/_lib/load-project-config.sh" 2>/dev/null || true
. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/review-lifecycle.sh"

ROOT="$(dhpk_root)"
PAYLOAD="$(dhpk_read_payload)"
SESSION_ID="$(extract_top_field session_id "$PAYLOAD")"
[ -n "$SESSION_ID" ] || SESSION_ID="unknown"
SESSION_ID="${SESSION_ID//$'\t'/_}"
SESSION_ID="${SESSION_ID//$'\n'/_}"
DISPATCH_ID="$(extract_top_field tool_use_id "$PAYLOAD")"
[ -z "$DISPATCH_ID" ] && DISPATCH_ID="$(extract_top_field dispatch_id "$PAYLOAD")"
[ -z "$DISPATCH_ID" ] && DISPATCH_ID="$(extract_tool_input dispatch_id "$PAYLOAD")"

SUBAGENT="$(extract_tool_input subagent_type "$PAYLOAD")"
[ -z "$SUBAGENT" ] && SUBAGENT="$(extract_tool_input subagent "$PAYLOAD")"

case "${SUBAGENT##*:}" in
    fast-worker|codex-fast-worker|agy-fast-worker|codex-worker|agy-worker)
        SESS="$(dhpk_sessions_dir "$ROOT")"
        STAMP="$(date +%s 2>/dev/null || date -u +%s)"
        mkdir -p "$SESS" 2>/dev/null || exit 0
        printf '%s %s pid=%s\n' "$STAMP" "$SUBAGENT" "$$" >> "$SESS/$DHPK_SIDECAR_FAST_WORKER_ACTIVE" 2>/dev/null || true
        exit 0 ;;
esac

SLOT=-1
if [ -n "$SUBAGENT" ]; then
    for i in "${!SENTINEL_AGENTS[@]}"; do
        # ##*: strips the plugin namespace (dhpk:doc-reviewer -> doc-reviewer)
        # so plugin-prefixed dispatch identities match bare SENTINEL_AGENTS names.
        if [ "${SENTINEL_AGENTS[$i]##*:}" = "${SUBAGENT##*:}" ]; then
            SLOT="$i"
            break
        fi
    done
fi

# Non-reviewer dispatches must not create session files.
[ "$SLOT" -lt 0 ] && exit 0

SENTINEL_NAME="${SENTINEL_NAMES[$SLOT]}"
ACTIVE_NAME="$(dhpk_active_marker "$SENTINEL_NAME")"
SESS="$(dhpk_sessions_dir "$ROOT")"
STAMP="$(date +%s 2>/dev/null || date -u +%s)"
SUBAGENT_BARE="${SUBAGENT##*:}"
[ -n "$DISPATCH_ID" ] || DISPATCH_ID="dispatch-${STAMP}-$$"
DISPATCH_ID="${DISPATCH_ID//$'\t'/_}"
DISPATCH_ID="${DISPATCH_ID//$'\n'/_}"

mkdir -p "$SESS" 2>/dev/null || exit 0
if [ ! -f "$SESS/$SENTINEL_NAME" ]; then
    printf '%s arm-on-dispatch:%s [arm-on-dispatch]\n' "$STAMP" "$SUBAGENT" > "$SESS/$SENTINEL_NAME" 2>/dev/null || true
    printf '%s\t%s\tarm-on-dispatch %s\n' "$SENTINEL_NAME" '[arm-on-dispatch]' "$SUBAGENT" >> "$SESS/$SENTINEL_PROVENANCE_FILE" 2>/dev/null || true
fi
# Keep a separate dispatch-attempt ledger so diagnostics can distinguish the
# current review window from old misplaced documents. The row shape is stable:
# sentinel TAB baseline-epoch TAB session-id TAB attempt TAB dispatch-id TAB agent.
DISPATCH_FILE="$SESS/$DHPK_SIDECAR_REVIEW_DISPATCH"
PREVIOUS_ATTEMPT="$(awk -F '\t' -v n="$SENTINEL_NAME" -v s="$SESSION_ID" -v a="$SUBAGENT_BARE" \
    '$1 == n && $3 == s && $6 == a && ($4 + 0) > max { max = $4 + 0 } END { print max + 0 }' \
    "$DISPATCH_FILE" 2>/dev/null || printf '0')"
ATTEMPT=$((PREVIOUS_ATTEMPT + 1))
printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$SENTINEL_NAME" "$STAMP" "$SESSION_ID" "$ATTEMPT" "$DISPATCH_ID" "$SUBAGENT_BARE" \
    >> "$DISPATCH_FILE" 2>/dev/null || true
printf '%s %s pid=%s\n' "$STAMP" "$SUBAGENT" "$$" >> "$SESS/$ACTIVE_NAME" 2>/dev/null || true

# Durable lifecycle evidence is independent of the legacy tab sidecar above.
# The scope digest is the sentinel's complete pending set; the diff digest is
# the current worktree identity.  A dispatch therefore cannot later be closed
# by a report from a different wave without an explicit identity match.
LIFECYCLE_SCOPE="$(dhpk_lifecycle_scope_id "$SESS/$SENTINEL_NAME" 2>/dev/null || true)"
LIFECYCLE_DIFF="$(dhpk_lifecycle_diff_id "$ROOT" 2>/dev/null || true)"
LIFECYCLE_TASK="$(dhpk_lifecycle_task_id "$SENTINEL_NAME" "$SESSION_ID" "$ATTEMPT" 2>/dev/null || true)"
LIFECYCLE_PRODUCER="$SUBAGENT_BARE"
LIFECYCLE_WAVE="$DISPATCH_ID"
LIFECYCLE_ADAPTER="$SUBAGENT_BARE"
LIFECYCLE_STAGE="review"
dhpk_lifecycle_emit planned "$LIFECYCLE_TASK" "$SUBAGENT_BARE" "$SESSION_ID" "$ATTEMPT" "$LIFECYCLE_SCOPE" "$LIFECYCLE_DIFF" "" "" \
    "$LIFECYCLE_PRODUCER" "$LIFECYCLE_WAVE" "$LIFECYCLE_SCOPE" "$LIFECYCLE_ADAPTER" "$LIFECYCLE_STAGE" "" "" "1" 2>/dev/null || true
dhpk_lifecycle_emit dispatched "$LIFECYCLE_TASK" "$SUBAGENT_BARE" "$SESSION_ID" "$ATTEMPT" "$LIFECYCLE_SCOPE" "$LIFECYCLE_DIFF" "" "" \
    "$LIFECYCLE_PRODUCER" "$LIFECYCLE_WAVE" "$LIFECYCLE_SCOPE" "$LIFECYCLE_ADAPTER" "$LIFECYCLE_STAGE" "" "" "1" 2>/dev/null || true
dhpk_lifecycle_emit started "$LIFECYCLE_TASK" "$SUBAGENT_BARE" "$SESSION_ID" "$ATTEMPT" "$LIFECYCLE_SCOPE" "$LIFECYCLE_DIFF" "" "" \
    "$LIFECYCLE_PRODUCER" "$LIFECYCLE_WAVE" "$LIFECYCLE_SCOPE" "$LIFECYCLE_ADAPTER" "$LIFECYCLE_STAGE" "" "" "1" 2>/dev/null || true

exit 0
