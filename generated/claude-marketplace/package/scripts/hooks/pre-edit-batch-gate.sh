#!/usr/bin/env bash
# PreToolUse (Edit|Write|MultiEdit): enforce dispatch-mode inline batch bounds.
# Any state/probe failure is deliberately fail-open.

set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh" 2>/dev/null || exit 0
. "$(dirname "$0")/_lib/payload.sh" 2>/dev/null || exit 0

batch_gate_main() {
    local payload file_path root rel session safe_session sess counter count now
    payload="$(dhpk_read_payload)"
    file_path="$(extract_tool_input file_path "$payload")"
    [ -n "$file_path" ] || return 0
    # NOTE: DHPK_INLINE_BATCH_OK is checked LATER (just before the WARN/block),
    # not here — the override must suppress the advisory/block, but the distinct-
    # file counter below MUST still accumulate so the Stop-time dispatch audit
    # (_lib/stop-dispatch-audit.sh, issue #80) can flag an override that grinds
    # inline edits with no fast-worker batch. Returning here left that counter
    # empty, silencing the audit for exactly the override case it targets.

    root="$(dhpk_root)"
    case "$file_path" in
        "$root"/*) rel="${file_path#"$root"/}" ;;
        /*) return 0 ;;
        ../*|*/../*|*/..) return 0 ;;
        ./*) rel="${file_path#./}" ;;
        *) rel="$file_path" ;;
    esac

    case "$rel" in
        openspec/*|.claude/artifacts/*|tasks.md|*/tasks.md) return 0 ;;
    esac

    sess="$(dhpk_sessions_dir "$root")"
    if [ -s "$sess/$DHPK_SIDECAR_FAST_WORKER_ACTIVE" ]; then
        now="$(date +%s 2>/dev/null)" || return 0
        if awk -v now="$now" '$1 ~ /^[0-9]+$/ && now-$1 <= 3600 {live=1} END {exit live ? 0 : 1}' \
            "$sess/$DHPK_SIDECAR_FAST_WORKER_ACTIVE" 2>/dev/null; then
            return 0
        fi
    fi

    session="$(extract_top_field session_id "$payload")"
    [ -n "$session" ] || session="default-session"
    safe_session="$(printf '%s' "$session" | tr -c 'A-Za-z0-9._-' '_')" || return 0
    mkdir -p "$sess" 2>/dev/null || return 0
    counter="$sess/.edit-batch-${safe_session}.files"
    [ ! -e "$counter" ] || [ -f "$counter" ] || return 0
    touch "$counter" 2>/dev/null || return 0

    if ! grep -Fxq -- "$rel" "$counter" 2>/dev/null; then
        printf '%s\n' "$rel" >> "$counter" 2>/dev/null || return 0
    fi
    count="$(awk 'NF {seen[$0]=1} END {for (x in seen) n++; print n+0}' "$counter" 2>/dev/null)" || return 0
    case "$count" in ''|*[!0-9]*) return 0 ;; esac

    # The override suppresses only the advisory/block — the counter above has
    # already recorded this file for the Stop-time audit.
    [ "${DHPK_INLINE_BATCH_OK:-0}" = "1" ] && return 0

    if [ "$count" -eq 3 ]; then
        echo "[edit-batch-gate] WARN: 3-file inline batch threshold reached; dispatch ≥3-file mechanical work as one fast-worker batch." >&2
    elif [ "$count" -ge 4 ] && [ "${DHPK_ORCHESTRATION_DISPATCH:-off}" = "on" ]; then
        echo "[edit-batch-gate] blocked: $count distinct inline source files; dispatch the pending mechanical work as one fast-worker batch or set DHPK_INLINE_BATCH_OK=1." >&2
        return 2
    fi
    return 0
}

batch_gate_main || {
    status=$?
    [ "$status" -eq 2 ] && exit 2
    exit 0
}
exit 0
