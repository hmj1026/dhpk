#!/usr/bin/env bash
# payload.sh — shared helpers for dhpk plugin hooks.
# Source-only — never execute directly. No side effects on sourcing.
#
# Constants exported:
#   SENTINEL_NAMES   — fixed sentinel file basenames (matches stop-review-reminder lookup)
#   SENTINEL_LABELS  — short human labels per slot (used in stdout/stderr)
#   SENTINEL_AGENTS  — agent invocation names per slot, derived from
#                      CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS env var (Claude Code
#                      exports each userConfig key). Falls back to plugin defaults.
#
# Helpers exported:
#   extract_tool_input <field> "<payload>"
#       — Pulls tool_input.<field> from a Claude Code PreToolUse/PostToolUse
#         JSON payload. Prefers jq; falls back to python3 when jq is missing.
#         Returns empty string on any error (callers MUST handle empty).

# Review sentinel SSOT — slots in fixed order:
#   0 code → 1 db → 2 sec → 3 frontend → 4 doc
# Adding/removing a slot means extending all three arrays together. Hooks that
# iterate SENTINEL_NAMES (clear-sentinel, reap-stale-sentinels, pre-bash-guard
# push-block, stop-review-reminder) and statusline.sh (which has its own SHORT
# label array) extend automatically as long as the arrays stay aligned.
SENTINEL_NAMES=(".pending-review" ".pending-db-review" ".pending-security-review" ".pending-frontend-review" ".pending-doc-review")
SENTINEL_LABELS=("code-reviewer" "database-reviewer" "security-reviewer" "frontend-reviewer" "doc-reviewer")

# Default agent names — overridable via userConfig.review_agents (comma-joined).
_dhpk_default_agents=("code-reviewer" "database-reviewer" "security-reviewer" "frontend-reviewer" "doc-reviewer")
if [ -n "${CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS:-}" ]; then
    IFS=',' read -r -a SENTINEL_AGENTS <<< "${CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS}"
else
    SENTINEL_AGENTS=("${_dhpk_default_agents[@]}")
fi

# Pad shorter override with defaults so downstream array indexing stays safe.
while [ ${#SENTINEL_AGENTS[@]} -lt ${#_dhpk_default_agents[@]} ]; do
    SENTINEL_AGENTS+=("${_dhpk_default_agents[${#SENTINEL_AGENTS[@]}]}")
done
unset _dhpk_default_agents

extract_tool_input() {
    local field="$1" payload="$2" out=""
    [ -z "$payload" ] && return 0
    # Both jq and python3 fallbacks tolerate errors — sourcing hooks may use
    # set -euo pipefail, so any non-zero must be swallowed here.
    if command -v jq >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | jq -r ".tool_input.${field} // empty" 2>/dev/null || true)"
    fi
    if [ -z "$out" ] && command -v python3 >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | FIELD="$field" python3 -c '
import sys, os, json
try:
    d = json.load(sys.stdin)
    print(d.get("tool_input", {}).get(os.environ.get("FIELD", ""), ""))
except Exception:
    pass
' 2>/dev/null || true)"
    fi
    printf '%s' "$out"
    return 0
}
