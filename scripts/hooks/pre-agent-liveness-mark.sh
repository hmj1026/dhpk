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

ROOT="$(dhpk_root)"
PAYLOAD="$(dhpk_read_payload)"

SUBAGENT="$(extract_tool_input subagent_type "$PAYLOAD")"
[ -z "$SUBAGENT" ] && SUBAGENT="$(extract_tool_input subagent "$PAYLOAD")"

case "${SUBAGENT##*:}" in
    fast-worker|codex-fast-worker|agy-fast-worker)
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

mkdir -p "$SESS" 2>/dev/null || exit 0
if [ ! -f "$SESS/$SENTINEL_NAME" ]; then
    printf '%s arm-on-dispatch:%s [arm-on-dispatch]\n' "$STAMP" "$SUBAGENT" > "$SESS/$SENTINEL_NAME" 2>/dev/null || true
    printf '%s\t%s\tarm-on-dispatch %s\n' "$SENTINEL_NAME" '[arm-on-dispatch]' "$SUBAGENT" >> "$SESS/$SENTINEL_PROVENANCE_FILE" 2>/dev/null || true
fi
printf '%s %s pid=%s\n' "$STAMP" "$SUBAGENT" "$$" >> "$SESS/$ACTIVE_NAME" 2>/dev/null || true

exit 0
