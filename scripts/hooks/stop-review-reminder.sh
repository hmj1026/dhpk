#!/usr/bin/env bash
# stop-review-reminder.sh — Stop hook
# Scans the three sentinels; if any exists, prints a reminder naming the
# configured review agent and exits 2 (Claude Code "block stop, feed stderr
# back as next-turn input" semantic).
#
# Profile: when hook_profile=minimal, suppresses all output and exits 0.

set -o pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Overlay project pluginConfigs so hook_profile / review_agents respect per-project
# .claude/settings.local.json (Claude Code only injects global pluginConfigs).
# MUST precede payload.sh because that lib reads CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS
# at source-time to populate SENTINEL_AGENTS.
. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"

PROFILE="${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-standard}"

[ "$PROFILE" = "minimal" ] && exit 0

SESS="$ROOT/.claude/artifacts/sessions"
FOUND=0

# Writes outer FOUND — must NOT be invoked in a subshell.
check_one() {
    local name="$1" agent="$2"
    local file="$SESS/$name"
    [ -f "$file" ] || return 0

    local count file_list extra=""
    count="$(wc -l < "$file" 2>/dev/null | tr -d ' ')"
    count="${count:-0}"
    file_list="$(head -5 "$file" 2>/dev/null | awk 'NF>=3 {print "    · " $3}')"
    [ "$count" -gt 5 ] && extra="    ... ${count} files total"

    # stderr — Claude Code's Stop hook feeds stderr back to Claude when exit=2.
    echo >&2 ""
    echo >&2 "-----------------------------------------------------------"
    echo >&2 "⚠  PENDING: $agent ($count file(s) awaiting review)"
    echo >&2 "   Triggering files:"
    echo >&2 "$file_list"
    [ -n "$extra" ] && echo >&2 "$extra"
    echo >&2 ""
    echo >&2 "   Recommended: invoke '$agent'"
    # Pre-resolve CLAUDE_PLUGIN_ROOT so the printed command is copy-paste-runnable
    # in a fresh shell where the env var is not set. Fall back to literal + export
    # hint if the hook itself was invoked without the var (unlikely but safe).
    if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
        echo >&2 "   Manual clear: bash \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh\" $name manual"
    else
        echo >&2 "   Manual clear (set CLAUDE_PLUGIN_ROOT to the dhpk plugin root first):"
        echo >&2 "                 bash \"\${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh\" $name manual"
    fi
    echo >&2 "-----------------------------------------------------------"
    FOUND=1
}

for i in "${!SENTINEL_NAMES[@]}"; do
    check_one "${SENTINEL_NAMES[$i]}" "${SENTINEL_AGENTS[$i]}"
done

# exit 2: blocks stop + feeds stderr back to Claude. exit 1 would be silent.
[ "$FOUND" -eq 1 ] && exit 2
exit 0
