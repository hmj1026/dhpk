#!/usr/bin/env bash
# pre-bash-dispatch.sh — PreToolUse (Bash) dispatcher.
#
# Runs the core security guard and Git branch-safety gate first (any non-zero
# exit aborts the Bash call). Then, if modules are active, runs their
# pre-bash-* and pre-commit-*
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
# The composed Git/review gate runs as a child process below. Export a receipt
# so it reuses this normalized project overlay instead of parsing settings a
# second time; direct invocations still load the config themselves.
export DHPK_PROJECT_CONFIG_LOADED=1
. "$PLUGIN_ROOT/scripts/hooks/_lib/modules.sh"
: "${DHPK_ACTIVE_MODULES:=$(dhpk_config_modules)}"

# Core guard — exit code bubbles up so dangerous-pattern blocks still work.
printf '%s' "$payload" | bash "$PLUGIN_ROOT/scripts/hooks/pre-bash-guard.sh"
rc=$?
[ "$rc" -ne 0 ] && exit "$rc"

# The former separate PreToolUse entry is deliberately composed here so Bash
# has one lifecycle hook while preserving protected-branch enforcement.
printf '%s' "$payload" | bash "$PLUGIN_ROOT/scripts/hooks/pretool-git-gate.sh"
rc=$?
[ "$rc" -ne 0 ] && exit "$rc"

if [ -n "${DHPK_ACTIVE_MODULES:-}" ]; then
    # Cheap pre-filter: pre-commit-* hooks only matter for `git commit` calls.
    # Skipping the fork for every other Bash call saves a full process tree
    # (bash + payload parse + jq) per active module on every command.
    # The hooks still self-skip on non-commit payloads, so this is purely perf.
    . "$PLUGIN_ROOT/scripts/hooks/_lib/payload.sh"
    . "$PLUGIN_ROOT/scripts/hooks/_lib/command-inspect.sh"
    _cmd="$(extract_tool_input command "$payload")"
    _is_commit=0
    dhpk_inspect_command "$_cmd"
    dhpk_command_has_commit && _is_commit=1

    # Claude Code 2.1.295+ reads timeout 2100 and onFailure block from the
    # Bash PreToolUse entry in hooks.json. That ceiling covers one commit
    # root each for JS, Python, Swift, and PHP, one Python group, and Swift
    # build/test settings no higher than 360/480 seconds. Inner deadlines
    # plus one second of grace are JS 212, Python 255, Swift 842, and PHP
    # 423 (1732 seconds); 368 seconds remain for preparation and cleanup.
    # Extra roots, groups, a larger Swift override, or any run that reaches
    # the ceiling can be interrupted. An interrupted check is not PASS.
    # Do not raise the inner deadlines. An unobserved host is not evidence
    # that this ceiling blocked the command.
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
