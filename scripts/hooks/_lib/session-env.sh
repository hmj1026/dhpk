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
#   DHPK_SIDECAR_FW_SELECTOR_WARNINGS  — session-start fast-worker probe warnings

DHPK_SIDECAR_UNRESOLVED_VERDICT=".unresolved-verdict"
DHPK_SIDECAR_REVIEW_BACKOFF=".review-reminder-backoff"
DHPK_SIDECAR_MODULE_FINDINGS=".module-findings"
DHPK_SIDECAR_FW_SELECTOR_WARNINGS=".fast-worker-selector-warnings"

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
