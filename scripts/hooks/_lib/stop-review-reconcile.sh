#!/usr/bin/env bash
# stop-review-reconcile.sh — Stop-time reviewer reconciliation core (sourceable).
#
# Background-dispatched reviewer agents do NOT reliably fire SubagentStop in
# Claude Code, so subagent-stop-verify.sh's auto-clear + active-marker removal
# never run for them (issue #76): the review doc lands in artifacts/reviews/ but
# the sentinel stays armed and the .active-* liveness marker lingers. A lingering
# active marker also makes stop-review-reminder.sh mis-report a phantom IN-FLIGHT
# dispatch and suppress a genuinely-needed re-dispatch forever (issue #77).
#
# This sweep runs at Stop, BEFORE the reminder scans its sentinels. For each
# armed review sentinel whose latest matching review doc is a FRESH, canonical,
# parseable passing artifact (its mtime postdates the sentinel that armed this
# cycle), it clears the sentinel via the clear-sentinel.sh SSOT and expires ONE
# active-marker entry for that slot. A missing, malformed, WARNING, or BLOCK
# artifact is left fully armed as an unresolved review obligation.
#
# It is a deliberate safety NET, not a replacement for subagent-stop-verify.sh:
# when SubagentStop DOES fire, that hook already cleared the slot and this sweep
# finds nothing armed. When it doesn't, this catches the drift one turn later.
# The clear is idempotent and gated on the same evidence boundary, so running
# both routes over the same slot is benign (Stop and SubagentStop are sequential;
# rm is idempotent; both go through clear-sentinel.sh).
#
# Requires the caller to have already sourced _lib/session-env.sh (dhpk_root,
# dhpk_sessions_dir, dhpk_active_marker, dhpk_reset_review_backoff) and
# _lib/payload.sh (SENTINEL_NAMES / SENTINEL_AGENTS). Emits one stderr line per
# reconciled slot; safe to re-run.

. "$(dirname "${BASH_SOURCE[0]}")/review-lifecycle.sh" 2>/dev/null || true

# _reconcile_fresh_doc <root> <agent-bare> <sentinel-file> — return 0 when the
# newest canonical review artifact exists, postdates the sentinel, and carries
# the same parseable passing evidence required by SubagentStop. A fresh file is
# not enough: malformed, warning, or blocking evidence remains an unresolved
# review obligation.
_reconcile_fresh_doc() {
    local root="$1" agent="$2" sentinel="$3" baseline="${4:-}" reviews_dir latest latest_mtime
    RECONCILE_DOC=""
    reviews_dir="$root/.claude/artifacts/reviews"
    [ -d "$reviews_dir" ] || return 1
    latest="$(ls -t "$reviews_dir/$agent"-*.md 2>/dev/null | head -1 || true)"
    [ -n "$latest" ] || return 1
    [ -n "$(find "$latest" -newer "$sentinel" 2>/dev/null)" ] || return 1
    if [ -n "$baseline" ]; then
        latest_mtime="$(stat -c %Y "$latest" 2>/dev/null || stat -f %m "$latest" 2>/dev/null || printf '0')"
        case "$latest_mtime" in ''|*[!0-9]*) return 1 ;; esac
        [ "$latest_mtime" -ge "$baseline" ] || return 1
    fi
    dhpk_lifecycle_artifact_is_passing "$latest" "$agent" || return 1
    RECONCILE_DOC="$latest"
    return 0
}

# _reconcile_drop_one_active <active-file> — remove ONE in-flight entry (the
# oldest line; in practice a slot carries a single active entry per wave, so this
# is the finished reviewer's), deleting the file when it empties. Mirrors
# subagent-stop-verify.sh's remove_one_active_entry so both routes agree — do not
# assume it targets a specific reviewer if a slot ever holds multiple entries.
_reconcile_drop_one_active() {
    local file="$1" tmp
    [ -f "$file" ] || return 0
    tmp="$(mktemp 2>/dev/null || printf '%s.tmp.%s' "$file" "$$")"
    awk 'NR > 1 { print }' "$file" > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 0; }
    if [ -s "$tmp" ]; then
        mv -f "$tmp" "$file" 2>/dev/null || rm -f "$tmp"
    else
        rm -f "$tmp" "$file"
    fi
}

# dhpk_stop_review_reconcile [session_id] — the sweep. Iterates SENTINEL_NAMES
# / SENTINEL_AGENTS. The optional session_id additionally runs the
# resumed-SendMessage obligation sweep (fix-resumed-review-sentinel-clearance):
# a resumed reviewer may already have had its active marker removed by the
# ORIGINAL dispatch's SubagentStop, so that case is not reachable through the
# active-marker gate below and needs its own session-scoped reconcile, defined
# in _lib/resumed-review-obligation.sh and sourced by this sweep's caller.
dhpk_stop_review_reconcile() {
    local sess_id="${1:-}"
    local root sess i name agent_bare sentinel active lifecycle_context lifecycle_task lifecycle_attempt lifecycle_scope lifecycle_diff
    local dispatch_record dispatch_baseline expected_session expected_attempt expected_dispatch
    root="$(dhpk_root)"
    sess="$(dhpk_sessions_dir "$root")"
    [ -d "$sess" ] || return 0
    if [ -n "$sess_id" ] && command -v dhpk_resumed_reconcile_sweep >/dev/null 2>&1; then
        dhpk_resumed_reconcile_sweep "$root" "$sess" "$sess_id"
    fi
    for i in "${!SENTINEL_NAMES[@]}"; do
        name="${SENTINEL_NAMES[$i]}"
        sentinel="$sess/$name"
        [ -f "$sentinel" ] || continue
        # Scope to THIS session: only reconcile a slot for which an active-liveness
        # marker exists — proof this session actually dispatched that reviewer (the
        # PreToolUse arm-on-dispatch mark, which for a background dispatch lingers
        # precisely because SubagentStop never fired). The review-doc glob below is
        # NOT session-scoped, so without this gate a concurrent session's fresh
        # doc-reviewer review doc (dhpk sessions share the artifacts dir) could
        # false-clear a gate this session's reviewer never satisfied.
        active="$sess/$(dhpk_active_marker "$name")"
        [ -f "$active" ] || continue
        # The active marker proves only that some reviewer dispatch was in
        # flight. Bind this fallback to the exact dispatch row for this Stop
        # session before inspecting the shared canonical review directory.
        dispatch_record="$(dhpk_lifecycle_dispatch_record "$name" "${SENTINEL_AGENTS[$i]##*:}" "$sess_id" 2>/dev/null || true)"
        [ -n "$dispatch_record" ] || continue
        IFS=$'\t' read -r _dispatch_sentinel dispatch_baseline expected_session expected_attempt expected_dispatch _dispatch_agent <<< "$dispatch_record"
        [ "$expected_session" = "$sess_id" ] || continue
        case "$dispatch_baseline" in ''|*[!0-9]*) continue ;; esac
        [ -n "$expected_attempt" ] && [ -n "$expected_dispatch" ] || continue
        agent_bare="${SENTINEL_AGENTS[$i]##*:}"
        _reconcile_fresh_doc "$root" "$agent_bare" "$sentinel" "$dispatch_baseline" || continue
        dhpk_lifecycle_artifact_matches_dispatch "$RECONCILE_DOC" "$expected_session" "$expected_attempt" "$expected_dispatch" 2>/dev/null || continue
        lifecycle_context="$(dhpk_lifecycle_context "$agent_bare" "$sess_id" 2>/dev/null || true)"
        lifecycle_task=""
        lifecycle_attempt="0"
        lifecycle_scope="$(dhpk_lifecycle_scope_id "$sentinel" 2>/dev/null || true)"
        lifecycle_diff="$(dhpk_lifecycle_diff_id "$root" 2>/dev/null || true)"
        if [ -n "$lifecycle_context" ]; then
            IFS=$'\t' read -r lifecycle_task lifecycle_attempt lifecycle_scope lifecycle_diff _lifecycle_session <<< "$lifecycle_context"
        fi
        [ -n "$lifecycle_task" ] || lifecycle_task="$(dhpk_lifecycle_task_id "$name" "${sess_id:-unknown}" 0 2>/dev/null || true)"
        # A consumer may only proceed after the producer's durable marker.  A
        # legacy/manual sentinel has no dispatch event, so this safety-net
        # materializes the marker from the already observed fresh artifact; it
        # still applies the same artifact/path/freshness/verdict checks.
        if dhpk_lifecycle_artifact_has_identity "$RECONCILE_DOC" 2>/dev/null && \
            ! dhpk_lifecycle_artifact_matches "$RECONCILE_DOC" "$lifecycle_scope" "$lifecycle_diff" 2>/dev/null; then
            continue
        fi
        dhpk_lifecycle_mark_artifact_ready "$lifecycle_task" "$agent_bare" "$sess_id" "$lifecycle_attempt" "$lifecycle_scope" "$lifecycle_diff" "$RECONCILE_DOC" 2>/dev/null || continue
        dhpk_lifecycle_require_ready "$lifecycle_task" 2>/dev/null || continue
        # Fresh review doc exists but SubagentStop never cleared it — clear via SSOT.
        if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh" ]; then
            bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh" "$name" "stop-reconcile" >/dev/null 2>&1 \
                || { rm -f "$sentinel"; dhpk_reset_review_backoff "$sess" "$name"; }
        else
            rm -f "$sentinel"
            dhpk_reset_review_backoff "$sess" "$name"
        fi
        # Expire the finished reviewer's active-liveness marker so the reminder
        # below does not report a phantom IN-FLIGHT dispatch (#77).
        active="$sess/$(dhpk_active_marker "$name")"
        _reconcile_drop_one_active "$active"
        echo "[stop-reconcile] auto-cleared $name (fresh review doc, no SubagentStop) + expired one active marker" >&2
    done
}
