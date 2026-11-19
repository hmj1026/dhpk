#!/usr/bin/env bash
# modules.sh — enumerate the active dhpk module set.
# Source-only — never execute directly. No side effects on sourcing.
#
# Active set comes from DHPK_ACTIVE_MODULES (exported by session-start.sh after
# validating each module's `requires`), falling back to CLAUDE_PLUGIN_OPTION_MODULES
# when the env didn't carry forward. Callers should source load-project-config.sh
# first so per-project overrides are reflected.
#
# bash 3.2-safe (macOS default): no namerefs / associative arrays.

. "${BASH_SOURCE[0]%/*}/runtime-config.sh"
#
# active_modules_list
#   Echo the active module names, one per line, trimmed, blanks skipped, deduped.
#   Iterate with a current-shell loop so an `exit` inside the body still
#   propagates (the Bash gate dispatcher relies on this):
#       while IFS= read -r m; do ... done < <(active_modules_list)

# _dhpk_module_trim <item>
# Result in _DHPK_MODULE. Plain items trim in pure bash (same result as
# `echo "$item" | xargs`: whitespace trimmed and collapsed). Items xargs would
# interpret (quotes, backslashes, CR/VT/FF blanks) or echo would take as an
# option (leading dash, even after blanks) still go through xargs, so the result stays identical
# for those rare inputs.
_dhpk_module_trim() {
    case "$1" in
        *\'*|*\"*|*\\*|*$'\r'*|*$'\v'*|*$'\f'*|-*|[[:blank:]]*-*) _DHPK_MODULE="$(echo "$1" | xargs)" ;;
        *) _dhpk_ws_normalize "$1"; _DHPK_MODULE="$_DHPK_NORM" ;;
    esac
}

active_modules_list() {
    local list _m _mods seen=""
    list="${DHPK_ACTIVE_MODULES:-$(dhpk_config_csv modules '')}"
    [ -n "$list" ] || return 0
    IFS=',' read -r -a _mods <<< "$list"
    for _m in "${_mods[@]}"; do
        _dhpk_module_trim "$_m"
        _m="$_DHPK_MODULE"
        [ -z "$_m" ] && continue
        case " $seen " in *" $_m "*) continue ;; esac
        seen="$seen $_m"
        printf '%s\n' "$_m"
    done
    return 0
}
