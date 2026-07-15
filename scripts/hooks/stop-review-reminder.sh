#!/usr/bin/env bash
# stop-review-reminder.sh — Stop hook
# Scans the sentinels; if any exists, prints a reminder naming the configured
# review agent and exits 2 (Claude Code "block stop, feed stderr back as
# next-turn input" semantic).
#
# Remind-once-then-yield: Claude Code sets stop_hook_active=true on the stdin
# payload when it re-enters Stop after a prior block. Honoring it converts a
# hard multi-block loop (which only ends when the harness block cap force-
# overrides, printing a "blocked N consecutive times" warning) into a single
# reminder that then lets the turn end.
#
# Profile: when hook_profile=minimal, suppresses all output and exits 0.

set -o pipefail

# Read the Stop hook payload first — before sourcing libs or anything that
# could consume stdin.
payload="$(cat 2>/dev/null || true)"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Overlay project pluginConfigs so hook_profile / review_agents respect per-project
# .claude/settings.local.json (Claude Code only injects global pluginConfigs).
# MUST precede payload.sh because that lib reads CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS
# at source-time to populate SENTINEL_AGENTS.
. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"

PROFILE="${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-standard}"

[ "$PROFILE" = "minimal" ] && exit 0

# Already reminded once this Stop cycle — yield so the turn can end instead of
# re-blocking until the harness block cap.
[ "$(extract_top_field stop_hook_active "$payload")" = "true" ] && exit 0

SESS="$ROOT/.claude/artifacts/sessions"
FOUND=0
BACKOFF_FILE="$SESS/.review-reminder-backoff"
BACKOFF_SECONDS="${DHPK_REVIEW_REMINDER_BACKOFF_SECONDS:-300}"
case "$BACKOFF_SECONDS" in
    ''|*[!0-9]*) BACKOFF_SECONDS=300 ;;
esac
REMINDER_SESSION="$(extract_top_field session_id "$payload")"
[ -n "$REMINDER_SESSION" ] || REMINDER_SESSION="default-session"

reminder_fingerprint() {
    local file="$1" hash=""
    hash="$(sha1sum "$file" 2>/dev/null | awk '{print $1}')"
    [ -n "$hash" ] || hash="$(cksum "$file" 2>/dev/null | awk '{print $1}')"
    printf '%s' "${hash:-unknown}"
}

reminder_is_debounced() {
    local name="$1" fingerprint="$2" now="$3" last=""
    [ -f "$BACKOFF_FILE" ] || return 1
    last="$(awk -F '\t' -v n="$name" -v s="$REMINDER_SESSION" -v f="$fingerprint" '$1==n && $2==s && $3==f {print $4; exit}' "$BACKOFF_FILE" 2>/dev/null || true)"
    [ -n "$last" ] || return 1
    [ $((now - last)) -lt "$BACKOFF_SECONDS" ]
}

record_reminder() {
    local name="$1" fingerprint="$2" now="$3" tmp=""
    mkdir -p "$SESS" 2>/dev/null || true
    tmp="$(mktemp 2>/dev/null || printf '%s.tmp.%s' "$BACKOFF_FILE" "$$")"
    awk -F '\t' -v n="$name" -v s="$REMINDER_SESSION" '$1!=n || $2!=s' "$BACKOFF_FILE" 2>/dev/null > "$tmp" || true
    printf '%s\t%s\t%s\t%s\n' "$name" "$REMINDER_SESSION" "$fingerprint" "$now" >> "$tmp"
    mv -f "$tmp" "$BACKOFF_FILE" 2>/dev/null || rm -f "$tmp"
}

# Writes outer FOUND — must NOT be invoked in a subshell.
check_one() {
    local name="$1" agent="$2"
    local file="$SESS/$name"
    [ -f "$file" ] || return 0
    local active_name="${name/.pending-/.active-}"
    local active_file="$SESS/$active_name"
    local active_count=0
    if [ -f "$active_file" ]; then
        active_count="$(awk 'NF { c++ } END { print c + 0 }' "$active_file" 2>/dev/null)"
        active_count="${active_count:-0}"
    fi

    local count file_list extra=""
    count="$(wc -l < "$file" 2>/dev/null | tr -d ' ')"
    count="${count:-0}"
    local now fingerprint
    now="$(date +%s)"
    fingerprint="$(reminder_fingerprint "$file")"
    if reminder_is_debounced "$name" "$fingerprint" "$now"; then
        return 0
    fi
    record_reminder "$name" "$fingerprint" "$now"
    # Batch grouping (D4.5): a large multi-change burst is grouped by originating
    # change/session (via the provenance sidecar) so it is reviewed per-group, not
    # as one oversized undifferentiated batch that invites a gate bypass. Every
    # file is still accounted for (grouped, not dropped). Small batches keep the
    # flat head-5 listing unchanged.
    local BATCH_GROUP_THRESHOLD=15
    local prov_file="$SESS/$SENTINEL_PROVENANCE_FILE"
    if [ "$count" -gt "$BATCH_GROUP_THRESHOLD" ] && [ -f "$prov_file" ]; then
        file_list="$(awk -F'\t' -v s="$name" '$1==s {c[$3]++} END {for (p in c) printf "    · group [%s]: %d file(s)\n", p, c[p]}' "$prov_file" 2>/dev/null)"
        extra="    ${count} files total — large batch; review per-change grouping above, not as one batch (groups shown where provenance is known)."
    else
        file_list="$(head -5 "$file" 2>/dev/null | awk 'NF>=3 {print "    · " $3}')"
        [ "$count" -gt 5 ] && extra="    ... ${count} files total"
    fi

    # stderr — Claude Code's Stop hook feeds stderr back to Claude when exit=2.
    echo >&2 ""
    echo >&2 "-----------------------------------------------------------"
    if [ "$active_count" -gt 0 ]; then
        echo >&2 "[WARN] IN-FLIGHT: $agent ($count file(s) awaiting review; $active_count dispatch(es) still running)"
    else
        echo >&2 "[WARN] PENDING: $agent ($count file(s) awaiting review)"
    fi
    echo >&2 "   Triggering files:"
    echo >&2 "$file_list"
    [ -n "$extra" ] && echo >&2 "$extra"
    echo >&2 ""
    if [ "$active_count" -gt 0 ]; then
        echo >&2 "   Recommended: wait for the existing $agent result; do not dispatch a duplicate reviewer."
    else
        echo >&2 "   Recommended: invoke '$agent'"
    fi
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
