#!/usr/bin/env bash
# subagent-stop-verify.sh — SubagentStop hook (non-blocking)
#
# The Review Sentinel auto-clear/reviewer-verification machinery this hook
# used to run (sentinel slot lookup, misplaced-review-doc diagnostics,
# unresolved-verdict sidecar, lifecycle event emission) was entirely keyed to
# `.pending-*` sentinel state and retired with the rest of Sentinel
# (#376/#377) — no Review-Gate-native replacement exists at this hook layer
# today. What remains: clearing a stopped fast-worker's liveness marker.
#
# Trigger: SubagentStop event (wired once in hooks/hooks.json).
# Cost: one jq/python3 parse, <20ms.

set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh"
. "$(dirname "$0")/_lib/payload.sh"

ROOT="$(dhpk_root)"
SESS="$(dhpk_sessions_dir "$ROOT")"

# Read stdin payload (JSON envelope from Claude Code SubagentStop event).
PAYLOAD="$(dhpk_read_payload)"

# Try multiple field names — SubagentStop envelope schema differs across
# Claude Code versions. The current (verified) schema delivers the reviewer
# identity in top-level `agent_type`, prefixed with the plugin namespace (e.g.
# `dhpk:doc-reviewer`); other candidates are kept for back-compat / forward-compat.
extract_subagent_name() {
    local payload="$1" out=""
    [ -z "$payload" ] && return 0
    if command -v jq >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | jq -r '
            .agent_type // .subagent_type // .subagent // .agent_name // .tool_input.subagent_type // empty
        ' 2>/dev/null || true)"
    fi
    if [ -z "$out" ] && command -v python3 >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(
        d.get("agent_type")
        or d.get("subagent_type")
        or d.get("subagent")
        or d.get("agent_name")
        or d.get("tool_input", {}).get("subagent_type")
        or ""
    )
except Exception:
    pass
' 2>/dev/null || true)"
    fi
    printf '%s' "$out"
}

remove_matching_active_entry() {
    local file="$1" agent="$2" tmp=""
    [ -f "$file" ] || return 0
    tmp="$(mktemp 2>/dev/null || printf '%s.tmp.%s' "$file" "$$")"
    awk -v wanted="${agent##*:}" '
        BEGIN { removed=0 }
        {
            candidate=$2
            sub(/^.*:/, "", candidate)
            if (!removed && candidate == wanted) { removed=1; next }
            print
        }
    ' "$file" > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 0; }
    if [ -s "$tmp" ]; then
        mv -f "$tmp" "$file" 2>/dev/null || rm -f "$tmp"
    else
        rm -f "$tmp" "$file"
    fi
}

SUBAGENT="$(extract_subagent_name "$PAYLOAD")"

case "${SUBAGENT##*:}" in
    fast-worker|codex-fast-worker|agy-fast-worker|codex-worker|agy-worker)
        remove_matching_active_entry "$SESS/$DHPK_SIDECAR_FAST_WORKER_ACTIVE" "$SUBAGENT"
        ;;
esac

exit 0
