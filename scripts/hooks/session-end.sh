#!/usr/bin/env bash
# session-end.sh — SessionEnd hook
#
# Session-teardown cleanup — the correct lifecycle point for work that used to
# run on every SessionStart (gitnexus reap) or every Stop (sentinel sweep):
#   1. Reap ORPHANED `gitnexus mcp` processes (opt-in: reap_stale_mcp_processes).
#      Moved from session-start.sh; reaping at teardown removes per-start overhead.
#   2. Sweep stale reviewer sentinels once (moved off the per-turn Stop hook).
#
# SessionEnd is non-blockable; always exit 0. Output is advisory only.
#
# Trigger: SessionEnd event (wired once in hooks/hooks.json).
# Cost: opt-in pgrep/ps scan + one reap-stale-sentinels.sh stat sweep.

set -o pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
. "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh" 2>/dev/null || true

# ---- Reap ORPHANED gitnexus MCP processes (opt-in) ----
# Only orphans are reaped (parent gone / reparented to pid 1). A process still
# owned by a live parallel session in the same repo must NOT be killed — that
# would disconnect THAT session's MCP server. Liveness is probed with `ps -p`
# (ownership-agnostic) rather than `kill -0`, which returns EPERM for a live
# cross-user parent (sudo / container root) and would mis-reap it.
if [ "${CLAUDE_PLUGIN_OPTION_REAP_STALE_MCP_PROCESSES:-false}" = "true" ] \
   && command -v pgrep >/dev/null 2>&1 && command -v ps >/dev/null 2>&1; then
    _gn_reaped=0
    for _gn_pid in $(pgrep -f "gitnexus mcp" 2>/dev/null); do
        _gn_ppid="$(ps -o ppid= -p "$_gn_pid" 2>/dev/null | tr -d ' ')"
        if [ -z "$_gn_ppid" ] || [ "$_gn_ppid" = "1" ] || ! ps -p "$_gn_ppid" >/dev/null 2>&1; then
            kill "$_gn_pid" 2>/dev/null && _gn_reaped=$((_gn_reaped + 1))
        fi
    done
    [ "$_gn_reaped" -gt 0 ] && echo "[session-end] reaped $_gn_reaped orphaned gitnexus mcp processes" >&2
    unset _gn_pid _gn_ppid _gn_reaped
fi

# ---- Stale reviewer sentinel sweep (warn-only; was a per-turn Stop hook) ----
# Default 24h threshold, warn-only — fresh pending reviews are preserved for the
# next session; the push-time hard-clear lives in pre-bash-guard.sh.
bash "$PLUGIN_ROOT/scripts/hooks/reap-stale-sentinels.sh" || true

exit 0
