#!/usr/bin/env bash
# stacks-pre-bash-dispatch.sh — dhpk-stacks PreToolUse (Bash) dispatcher.
#
# The dhpk core plugin owns the security guard and the Git branch-safety gate.
# This dispatcher only runs the gates of the stack modules the project enabled
# through the dhpk-stacks `modules` setting:
#   modules/<m>/hooks/pre-bash-*.sh
#   modules/<m>/hooks/pre-commit-*.sh   (only for `git commit` commands)
# Each hook receives the same stdin payload Claude Code passed here. Any
# non-zero hook status becomes exit 2, which blocks the Bash call.

set -o pipefail

_dhpk_self="$0"
while [ -L "$_dhpk_self" ]; do
    _dhpk_link="$(readlink "$_dhpk_self")"
    case "$_dhpk_link" in /*) _dhpk_self="$_dhpk_link" ;; *) _dhpk_self="$(dirname "$_dhpk_self")/$_dhpk_link" ;; esac
done
_dhpk_hooks_dir="$(cd -P "$(dirname "$_dhpk_self")" 2>/dev/null && pwd)" || {
    echo "[stacks-pre-bash-dispatch] cannot resolve dhpk-stacks package root; blocking" >&2
    exit 2
}
. "$_dhpk_hooks_dir/_lib/plugin-root.sh"
dhpk_plugin_root "$_dhpk_hooks_dir" || {
    echo "[stacks-pre-bash-dispatch] cannot resolve dhpk-stacks package root; blocking" >&2
    exit 2
}

. "$PLUGIN_ROOT/scripts/hooks/_lib/session-env.sh"
payload="$(dhpk_read_payload)"

# Project pluginConfigs overlay, so a project's .claude/settings.local.json can
# override the global `modules` value.
. "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh"
export DHPK_PROJECT_CONFIG_LOADED=1
. "$PLUGIN_ROOT/scripts/hooks/_lib/modules.sh"
: "${DHPK_ACTIVE_MODULES:=$(dhpk_config_modules)}"
[ -n "${DHPK_ACTIVE_MODULES:-}" ] || exit 0

unset DHPK_INSPECT_CACHE DHPK_INSPECT_CACHE_CMD DHPK_INSPECT_CACHE_CWD
. "$PLUGIN_ROOT/scripts/hooks/_lib/payload.sh"
. "$PLUGIN_ROOT/scripts/hooks/_lib/command-inspect.sh"
_cmd="$(extract_tool_input command "$payload")"
_is_commit=0
if [ -n "$_cmd" ]; then
    dhpk_inspect_command "$_cmd"
    dhpk_inspect_export_cache "$_cmd"
    dhpk_command_has_commit && _is_commit=1
fi

# Inner deadlines and the 1800 second outer ceiling match the core Bash
# dispatcher (see docs/hook-extension.md, "Bash outer ceiling"). Do not raise
# the inner deadlines. An interrupted check is not PASS.
while IFS= read -r _m; do
    for hook in "$PLUGIN_ROOT/modules/$_m/hooks/"pre-bash-*.sh \
                "$PLUGIN_ROOT/modules/$_m/hooks/"pre-commit-*.sh; do
        [ -f "$hook" ] || continue
        case "$hook" in
            */pre-commit-*.sh) [ "$_is_commit" -eq 1 ] || continue ;;
        esac
        printf '%s' "$payload" | bash "$hook"
        rc=${PIPESTATUS[1]}
        [ "$rc" -ne 0 ] && exit 2
    done
done < <(active_modules_list)

exit 0
