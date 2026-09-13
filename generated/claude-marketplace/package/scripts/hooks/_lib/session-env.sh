#!/usr/bin/env bash
# session-env.sh — canonical session-environment resolution for dhpk hooks.
# Source-only — never execute directly. No side effects on sourcing.
#
# Why this exists
# ---------------
# Before this lib, every hook re-derived the project root and the sessions dir
# inline, with three divergent fallback chains in the tree. One resolution
# order, defined once, sourced everywhere.
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
#
# Session-state sidecar basenames (registry — keeps hooks off bare literals):
#   DHPK_SIDECAR_MODULE_FINDINGS       — post-edit-dispatch / stop-advisory-dispatch accumulator
#   DHPK_SIDECAR_FAST_WORKER_ACTIVE    — shared fast-worker liveness marker
#
# The Review Sentinel `.pending-*`/`.active-*` mechanism and its sidecars
# (unresolved-verdict escalation, review-reminder backoff, resumed-review
# obligations, dispatch-attempt baselines, lifecycle events, producer-ready
# markers, review telemetry, accepted-outcome cost, retry/quota/audit state)
# were retired with the rest of Sentinel (#376/#377) — see
# docs/adr/0018-production-migration-observation-checkpoint.md.

DHPK_SIDECAR_MODULE_FINDINGS=".module-findings"
DHPK_SIDECAR_FAST_WORKER_ACTIVE=".active-fast-worker"

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

# dhpk_current_session_id — this session's identity for orchestrator-invoked
# (non-hook) scripts, e.g. record-resumed-obligation.sh / reconcile-resumed-review.sh.
# Claude Code exports CLAUDE_CODE_SESSION_ID for every Bash tool call; this is
# the same identity a hook payload's top-level `session_id` field carries, so
# obligations recorded here match against the Stop/SubagentStop reconcile sweep.
dhpk_current_session_id() {
    printf '%s' "${CLAUDE_CODE_SESSION_ID:-${CLAUDE_SESSION_ID:-}}"
    return 0
}
