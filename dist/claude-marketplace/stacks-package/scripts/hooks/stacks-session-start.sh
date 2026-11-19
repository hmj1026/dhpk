#!/usr/bin/env bash
# stacks-session-start.sh — dhpk-stacks SessionStart hook.
#
# Validates the `modules` setting against the modules this plugin ships and
# prints one line per enabled module. It reads no project files, takes no
# snapshots, and never blocks the session. Needs the dhpk core plugin: the core
# plugin owns the dispatch notes and the Bash safety gates.

set -o pipefail

_dhpk_self="$0"
while [ -L "$_dhpk_self" ]; do
    _dhpk_link="$(readlink "$_dhpk_self")"
    case "$_dhpk_link" in /*) _dhpk_self="$_dhpk_link" ;; *) _dhpk_self="$(dirname "$_dhpk_self")/$_dhpk_link" ;; esac
done
_dhpk_hooks_dir="$(cd -P "$(dirname "$_dhpk_self")" 2>/dev/null && pwd)" || exit 1
. "$_dhpk_hooks_dir/_lib/plugin-root.sh"
dhpk_plugin_root "$_dhpk_hooks_dir" || exit 1
. "$PLUGIN_ROOT/scripts/hooks/_lib/session-env.sh"
. "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh"

MODULES="$(dhpk_config_csv modules '')"
[ -n "$MODULES" ] || exit 0

if ! command -v python3 >/dev/null 2>&1; then
    echo "[stacks-session-start] WARN: python3 is missing; modules '$MODULES' were not validated" >&2
    exit 0
fi

while IFS=$'\t' read -r tag first second; do
    case "$tag" in
        WARN) echo "[stacks-session-start] WARN: $first" >&2 ;;
        MODULE) echo "[stacks-session-start] module enabled: $first — $second" ;;
    esac
done < <(python3 "$PLUGIN_ROOT/scripts/hooks/_lib/activate-modules.py" "$PLUGIN_ROOT" "$MODULES" 2>/dev/null)
exit 0
