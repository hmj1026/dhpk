#!/usr/bin/env bash
# pre-bash-dispatch.sh — PreToolUse (Bash) dispatcher.
#
# Runs the core pre-bash-guard.sh first (any non-zero exit aborts the bash
# call). Then, if modules are active, runs their pre-bash-* and pre-commit-*
# hooks synchronously — these gates intentionally block the bash call when
# they exit non-zero (e.g. JS lint failure blocking a commit).
#
# Convention: module PreToolUse Bash hooks live at
#   modules/<m>/hooks/pre-bash-*.sh
#   modules/<m>/hooks/pre-commit-*.sh
# and receive the same stdin payload Claude Code passed us.

set -o pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"

. "$PLUGIN_ROOT/scripts/hooks/_lib/session-env.sh"
payload="$(dhpk_read_payload)"

# Overlay project pluginConfigs so module selection respects per-project
# .claude/settings.local.json (Claude Code only injects global pluginConfigs).
. "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh"
. "$PLUGIN_ROOT/scripts/hooks/_lib/modules.sh"
: "${DHPK_ACTIVE_MODULES:=${CLAUDE_PLUGIN_OPTION_MODULES:-}}"

# Core guard — exit code bubbles up so dangerous-pattern blocks still work.
printf '%s' "$payload" | bash "$PLUGIN_ROOT/scripts/hooks/pre-bash-guard.sh"
rc=$?
[ "$rc" -ne 0 ] && exit "$rc"

if [ -n "${DHPK_ACTIVE_MODULES:-}" ]; then
    # Cheap pre-filter: pre-commit-* hooks only matter for `git commit` calls.
    # Skipping the fork for every other Bash call saves a full process tree
    # (bash + payload parse + jq) per active module on every command.
    # The hooks still self-skip on non-commit payloads, so this is purely perf.
    . "$PLUGIN_ROOT/scripts/hooks/_lib/payload.sh"
    _cmd="$(extract_tool_input command "$payload")"
    _is_commit=0
    case "$_cmd" in
        *"git commit-tree"*) _is_commit=0 ;;
        *"git commit"*)      _is_commit=1 ;;
    esac

    # Process substitution keeps this loop in the current shell, so the
    # `exit "$rc"` below still aborts the whole bash call on a gate failure.
    while IFS= read -r _m; do
        for hook in "$PLUGIN_ROOT/modules/$_m/hooks/"pre-bash-*.sh \
                    "$PLUGIN_ROOT/modules/$_m/hooks/"pre-commit-*.sh; do
            [ -f "$hook" ] || continue
            case "$hook" in
                */pre-commit-*.sh) [ "$_is_commit" -eq 1 ] || continue ;;
            esac
            printf '%s' "$payload" | bash "$hook"
            rc=$?
            [ "$rc" -ne 0 ] && exit "$rc"
        done
    done < <(active_modules_list)
fi

exit 0
