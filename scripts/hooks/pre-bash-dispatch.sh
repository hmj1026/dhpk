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

payload="$(cat 2>/dev/null || true)"

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"

# Core guard — exit code bubbles up so dangerous-pattern blocks still work.
printf '%s' "$payload" | bash "$PLUGIN_ROOT/scripts/hooks/pre-bash-guard.sh"
rc=$?
[ "$rc" -ne 0 ] && exit "$rc"

if [ -n "${DHPK_ACTIVE_MODULES:-}" ]; then
    IFS=',' read -r -a _mods <<< "$DHPK_ACTIVE_MODULES"
    for _m in "${_mods[@]}"; do
        _m="$(echo "$_m" | xargs)"
        [ -z "$_m" ] && continue
        for hook in "$PLUGIN_ROOT/modules/$_m/hooks/"pre-bash-*.sh \
                    "$PLUGIN_ROOT/modules/$_m/hooks/"pre-commit-*.sh; do
            [ -f "$hook" ] || continue
            printf '%s' "$payload" | bash "$hook"
            rc=$?
            [ "$rc" -ne 0 ] && exit "$rc"
        done
    done
fi

exit 0
