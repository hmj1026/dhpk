#!/usr/bin/env bash
# plugin-root.sh -- resolve this plugin's root for a hook script.
#
# CLAUDE_PLUGIN_ROOT is process-wide. It can name another plugin, and then
# sourcing "$CLAUDE_PLUGIN_ROOT/scripts/hooks/_lib/..." fails. Use it only when
# it holds this plugin's hook library. Otherwise use the script's own root.
#
# Usage:
#   . "$(dirname "$0")/_lib/plugin-root.sh"
#   PLUGIN_ROOT="$(dhpk_plugin_root "$(dirname "$0")")"

# dhpk_plugin_root <hooks-dir>
#   <hooks-dir> is the directory of the calling script (scripts/hooks).
#   Prints the plugin root.
dhpk_plugin_root() {
    local env_root="${CLAUDE_PLUGIN_ROOT:-}"
    if [ -n "$env_root" ] && [ -f "$env_root/scripts/hooks/_lib/session-env.sh" ]; then
        printf '%s\n' "$env_root"
        return 0
    fi
    (cd "$1/../.." && pwd)
}
