#!/usr/bin/env bash
# subagent-stop-verify.sh — SubagentStop hook (non-blocking)
#
# Plugs reviewer dispatch gaps: when a reviewer agent stops SUCCESSFULLY but its
# own sentinel still exists, auto-clear it on the reviewer's behalf (reviewers
# spawned via the Agent/Task tool do not reliably self-run their closing
# clear-sentinel.sh); when exit status is non-zero, leave the sentinel armed and
# log to .claude/artifacts/agent-failures.log for next-session SessionStart /
# manual review.
#
# Design:
# - Sources _lib/payload.sh SSOT (SENTINEL_NAMES / SENTINEL_AGENTS).
# - Reads stdin JSON; tries multiple field names because Claude Code's
#   SubagentStop envelope schema has evolved across versions.
# - Always exits 0 (non-blocking — must not block the next chain step).
# - Profile-aware: minimal profile suppresses stderr summary; failure log is
#   still appended so the trail survives.
#
# Trigger: SubagentStop event (wired once in hooks/hooks.json).
# Cost: file stat + one jq/python3 parse, <50ms.

set -o pipefail

# Project pluginConfigs override must precede payload.sh — payload.sh reads
# CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS at source-time to populate SENTINEL_AGENTS.
. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/learning-db.sh"
. "$(dirname "$0")/_lib/json-out.sh"

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SESS="$ROOT/.claude/artifacts/sessions"
LOG="$ROOT/.claude/artifacts/agent-failures.log"
PROFILE="${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-standard}"

# Read stdin payload (JSON envelope from Claude Code SubagentStop event).
PAYLOAD="$(cat 2>/dev/null || true)"

# Try multiple field names — SubagentStop envelope schema differs across
# Claude Code versions (subagent_type vs subagent vs tool_input.subagent_type).
extract_subagent_name() {
    local payload="$1" out=""
    [ -z "$payload" ] && return 0
    if command -v jq >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | jq -r '
            .subagent_type // .subagent // .tool_input.subagent_type // empty
        ' 2>/dev/null || true)"
    fi
    if [ -z "$out" ] && command -v python3 >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(
        d.get("subagent_type")
        or d.get("subagent")
        or d.get("tool_input", {}).get("subagent_type")
        or ""
    )
except Exception:
    pass
' 2>/dev/null || true)"
    fi
    printf '%s' "$out"
}

# Maintenance note: if Claude Code adds new failure-status field names (e.g.
# `failed`, `error`, `outcome.status`), extend the candidate list below.
# Missing exit_status is treated as success — intentionally conservative to
# avoid false alarms.
extract_exit_status() {
    local payload="$1" out=""
    [ -z "$payload" ] && { printf '0'; return 0; }
    if command -v jq >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | jq -r '
            .exit_status // .status // .exit_code // empty
        ' 2>/dev/null || true)"
    fi
    if [ -z "$out" ] && command -v python3 >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    v = d.get("exit_status")
    if v is None:
        v = d.get("status")
    if v is None:
        v = d.get("exit_code")
    print("" if v is None else v)
except Exception:
    pass
' 2>/dev/null || true)"
    fi
    [ -z "$out" ] && out="0"
    printf '%s' "$out"
}

SUBAGENT="$(extract_subagent_name "$PAYLOAD")"
EXIT_STATUS="$(extract_exit_status "$PAYLOAD")"

# Map subagent name → SENTINEL_AGENTS slot index → sentinel filename.
SLOT=-1
if [ -n "$SUBAGENT" ]; then
    for i in "${!SENTINEL_AGENTS[@]}"; do
        if [ "${SENTINEL_AGENTS[$i]}" = "$SUBAGENT" ]; then
            SLOT="$i"
            break
        fi
    done
fi

# Not a reviewer agent (or schema missing subagent name) → silent exit 0.
if [ "$SLOT" -lt 0 ]; then
    exit 0
fi

SENTINEL_NAME="${SENTINEL_NAMES[$SLOT]}"
SENTINEL_FILE="$SESS/$SENTINEL_NAME"
TIMESTAMP="$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

if [ "$EXIT_STATUS" != "0" ]; then
    # Case A: subagent failed.
    SENTINEL_STATE="none"
    [ -f "$SENTINEL_FILE" ] && SENTINEL_STATE="$SENTINEL_NAME"
    echo "$TIMESTAMP $SUBAGENT exit=$EXIT_STATUS sentinel=$SENTINEL_STATE" >> "$LOG" || true
    ldb_record failure "agent:$SUBAGENT" "exit=$EXIT_STATUS"
    if [ "$PROFILE" != "minimal" ]; then
        msg="[subagent-verify] SUBAGENT FAILURE: $SUBAGENT (exit=$EXIT_STATUS)"
        if [ -f "$SENTINEL_FILE" ]; then
            msg="$msg
Sentinel still present: $SENTINEL_NAME — the next reviewer in the chain may not fire."
        fi
        msg="$msg
Logged to: .claude/artifacts/agent-failures.log"
        emit_system_message "$msg"
    fi
elif [ -f "$SENTINEL_FILE" ]; then
    # Case B: subagent succeeded but sentinel uncleared — auto-clear it on the
    # reviewer's behalf. Reviewers spawned via the Agent/Task tool do not
    # reliably run their own closing clear-sentinel.sh, which would otherwise
    # leave a stale sentinel that falsely blocks the opsx-apply-goal end-gate.
    # This fires at the same moment (SubagentStop) the reviewer's own closing
    # clear would have, scoped strictly to this reviewer's own slot, so it is
    # equivalent to the reviewer having self-cleared. Run the SSOT clearer first
    # (SENTINEL_NAMES whitelist + ldb success record); its stdout MUST be
    # suppressed so its plain text cannot corrupt this hook's single JSON
    # systemMessage envelope (a hook may emit at most one JSON object). Then
    # unconditionally rm the exact sentinel THIS hook detected ($SENTINEL_FILE,
    # built from ROOT above): clear-sentinel.sh resolves its own ROOT via
    # git-toplevel, so if that ever diverges from CLAUDE_PROJECT_DIR (e.g. a
    # worktree subagent) the guaranteed rm keeps the AUTO-CLEARED report honest.
    # rm -f is idempotent — it no-ops when the clearer already removed the file.
    if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh" ]; then
        bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh" "$SENTINEL_NAME" "subagent-stop-auto" >/dev/null 2>&1 || true
    fi
    rm -f "$SENTINEL_FILE"
    echo "$TIMESTAMP $SUBAGENT exit=0 sentinel=$SENTINEL_NAME (auto-cleared)" >> "$LOG" || true
    ldb_record failure "sentinel-uncleared:$SENTINEL_NAME" "$SUBAGENT"
    if [ "$PROFILE" != "minimal" ]; then
        emit_system_message "[subagent-verify] AUTO-CLEARED: $SUBAGENT finished; cleared $SENTINEL_NAME on its behalf.
Logged to: .claude/artifacts/agent-failures.log"
    fi
fi

# Advisory only — never block the chain.
exit 0
