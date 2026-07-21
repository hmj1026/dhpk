#!/usr/bin/env bash
# session-env.sh — canonical session-environment resolution for dhpk hooks.
# Source-only — never execute directly. No side effects on sourcing.
#
# Why this exists
# ---------------
# Before this lib, every hook re-derived the project root and the sessions dir
# inline, with three divergent fallback chains in the tree:
#   ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel … || pwd)}"
#   ROOT="$(git rev-parse --show-toplevel … || pwd)"          (ignores env)
#   repo_root="${CLAUDE_PROJECT_DIR:-$(pwd)}"                 (ignores git)
# The divergence was load-bearing: subagent-stop-verify.sh could not trust
# clear-sentinel.sh's root resolution and defensively cleared the sentinel a
# second time by hand. One resolution order, defined once, sourced everywhere.
#
# Resolution order (matches what Claude Code guarantees for hooks):
#   1. CLAUDE_PROJECT_DIR — set by Claude Code for every hook invocation;
#      correct even in git worktrees where toplevel diverges.
#   2. git rev-parse --show-toplevel — plain-Bash invocations inside a repo.
#   3. pwd — last resort (non-repo, e.g. throwaway test dirs pre-init).
#
# Functions (all echo their result; all safe under set -euo pipefail):
#   dhpk_root                 — canonical project root per the order above.
#   dhpk_sessions_dir [root]  — "<root>/.claude/artifacts/sessions"; resolves
#                               dhpk_root itself when no arg is given.
#   dhpk_read_payload         — stdin, empty string on any error. Call before
#                               anything else consumes stdin.
#   dhpk_active_marker <pending-basename>
#                             — the ".active-*" liveness companion for a
#                               ".pending-*" sentinel basename.
#
# Session-state sidecar basenames (registry — keeps hooks off bare literals;
# sentinel basenames themselves stay in payload.sh SENTINEL_NAMES, the SSOT):
#   DHPK_SIDECAR_UNRESOLVED_VERDICT    — subagent-stop-verify verdict escalation
#   DHPK_SIDECAR_REVIEW_BACKOFF        — stop-review-reminder debounce stamp
#   DHPK_SIDECAR_MODULE_FINDINGS       — post-edit-dispatch / stop-dispatch accumulator
#   DHPK_SIDECAR_FAST_WORKER_ACTIVE    — shared fast-worker liveness marker

DHPK_SIDECAR_UNRESOLVED_VERDICT=".unresolved-verdict"
DHPK_SIDECAR_REVIEW_BACKOFF=".review-reminder-backoff"
DHPK_SIDECAR_MODULE_FINDINGS=".module-findings"
DHPK_SIDECAR_FAST_WORKER_ACTIVE=".active-fast-worker"

# dhpk_reset_review_backoff <sessions_dir> <sentinel_name>
#
# Drop stop-review-reminder's escalation rows for one slot. Call this wherever a
# sentinel is legitimately cleared.
#
# The "this gate has been ignored N times" counter is keyed on
# (sentinel, session, fingerprint-of-sentinel-contents). Clearing the sentinel
# does not touch that row, so when later edits re-arm the same slot with the same
# file list the fingerprint matches again and the counter resumes climbing —
# escalating to a HARD DIRECTIVE across rounds in which a reviewer ran every
# time. Rows for every session are dropped, not just the caller's: once the
# sentinel is gone, no session's fingerprint for it refers to anything.
dhpk_reset_review_backoff() {
    local sess="$1" name="$2" file tmp
    [ -n "$sess" ] && [ -n "$name" ] || return 0
    file="$sess/$DHPK_SIDECAR_REVIEW_BACKOFF"
    [ -f "$file" ] || return 0
    tmp="$(mktemp 2>/dev/null || printf '%s.reset.%s' "$file" "$$")"
    if awk -F '\t' -v n="$name" '$1 != n' "$file" > "$tmp" 2>/dev/null; then
        mv -f "$tmp" "$file" 2>/dev/null || rm -f "$tmp"
    else
        rm -f "$tmp"
    fi
    return 0
}

dhpk_root() {
    if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
        printf '%s' "$CLAUDE_PROJECT_DIR"
    else
        printf '%s' "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
    fi
    return 0
}

dhpk_sessions_dir() {
    local root="${1:-}"
    [ -n "$root" ] || root="$(dhpk_root)"
    printf '%s/.claude/artifacts/sessions' "$root"
    return 0
}

dhpk_read_payload() {
    cat 2>/dev/null || true
    return 0
}

dhpk_active_marker() {
    printf '%s' "${1/.pending-/.active-}"
    return 0
}
