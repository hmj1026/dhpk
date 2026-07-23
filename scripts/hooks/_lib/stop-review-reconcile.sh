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
# armed review sentinel whose latest matching review doc is FRESH (its mtime
# postdates the sentinel that armed this cycle), it clears the sentinel via the
# clear-sentinel.sh SSOT and expires ONE active-marker entry for that slot —
# a fresh doc proves the reviewer finished, so both are safe. A slot with no
# fresh doc is left fully armed (real pending review, or a genuinely in-flight
# reviewer that has not written its doc yet).
#
# It is a deliberate safety NET, not a replacement for subagent-stop-verify.sh:
# when SubagentStop DOES fire, that hook already cleared the slot and this sweep
# finds nothing armed. When it doesn't, this catches the drift one turn later.
# The clear is idempotent and gated on the same freshness boundary, so running
# both routes over the same slot is benign (Stop and SubagentStop are sequential;
# rm is idempotent; both go through clear-sentinel.sh).
#
# Requires the caller to have already sourced _lib/session-env.sh (dhpk_root,
# dhpk_sessions_dir, dhpk_active_marker, dhpk_reset_review_backoff) and
# _lib/payload.sh (SENTINEL_NAMES / SENTINEL_AGENTS). Emits one stderr line per
# reconciled slot; safe to re-run.

# _reconcile_fresh_doc <root> <agent-bare> <sentinel-file> — return 0 when the
# newest artifacts/reviews/<agent>-*.md exists AND postdates the sentinel file.
# Mirrors subagent-stop-verify.sh's has_fresh_review_artifact gate: existence +
# freshness ONLY, never verdict-parseability, so a fresh-but-unparseable review
# still clears rather than looping the orchestrator.
_reconcile_fresh_doc() {
    local root="$1" agent="$2" sentinel="$3" reviews_dir latest
    reviews_dir="$root/.claude/artifacts/reviews"
    [ -d "$reviews_dir" ] || return 1
    latest="$(ls -t "$reviews_dir/$agent"-*.md 2>/dev/null | head -1 || true)"
    [ -n "$latest" ] || return 1
    [ -n "$(find "$latest" -newer "$sentinel" 2>/dev/null)" ] || return 1
    return 0
}

# _reconcile_drop_one_active <active-file> — remove a single in-flight entry
# (the completed reviewer's), deleting the file when it empties. Mirrors
# subagent-stop-verify.sh's remove_one_active_entry so both routes agree.
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

# dhpk_stop_review_reconcile — the sweep. Iterates SENTINEL_NAMES / SENTINEL_AGENTS.
dhpk_stop_review_reconcile() {
    local root sess i name agent_bare sentinel active
    root="$(dhpk_root)"
    sess="$(dhpk_sessions_dir "$root")"
    [ -d "$sess" ] || return 0
    for i in "${!SENTINEL_NAMES[@]}"; do
        name="${SENTINEL_NAMES[$i]}"
        sentinel="$sess/$name"
        [ -f "$sentinel" ] || continue
        agent_bare="${SENTINEL_AGENTS[$i]##*:}"
        _reconcile_fresh_doc "$root" "$agent_bare" "$sentinel" || continue
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
