#!/usr/bin/env bash
# runtime-config.sh — normalized runtime configuration seam for dhpk hooks.
# Source-only — never execute directly. No settings-file I/O is performed here;
# load-project-config.sh owns project overlay and sources this library afterward.
#
# Compatibility: callers may continue reading CLAUDE_PLUGIN_OPTION_* directly.
# New code should use these helpers so defaults, one-shot overrides, booleans,
# and comma-separated values have one implementation.
#
# bash 3.2-safe: no namerefs, associative arrays, or ${var^^} expansion.

_dhpk_config_env_name() {
    local _key="$1" _upper
    case "$_key" in
        CLAUDE_PLUGIN_OPTION_*|DHPK_*)
            printf '%s' "$_key"
            return 0
            ;;
    esac
    _upper="$(printf '%s' "$_key" | tr '[:lower:]' '[:upper:]')"
    case "$_upper" in
        ''|*[!A-Z0-9_]*) return 1 ;;
    esac
    printf 'CLAUDE_PLUGIN_OPTION_%s' "$_upper"
}

# dhpk_config_get <key> <default> [override-env]
# Reads an option from the optional one-shot override first, then the
# CLAUDE_PLUGIN_OPTION_* compatibility environment, then the supplied default.
dhpk_config_get() {
    local _key="${1:-}" _default="${2:-}" _override="${3:-}"
    local _env_name="" _value=""
    [ -n "$_key" ] || { printf '%s' "$_default"; return 0; }

    if [ -n "$_override" ]; then
        eval "_value=\${$_override-}"
        if [ -n "$_value" ]; then
            printf '%s' "$_value"
            return 0
        fi
    fi

    _env_name="$(_dhpk_config_env_name "$_key")" || {
        printf '%s' "$_default"
        return 0
    }
    eval "_value=\${$_env_name-}"
    if [ -n "$_value" ]; then printf '%s' "$_value"; else printf '%s' "$_default"; fi
    return 0
}

# dhpk_config_profile — normalize hook_profile to the documented enum.
dhpk_config_profile() {
    local _profile
    _profile="$(dhpk_config_get hook_profile standard DHPK_HOOK_PROFILE)"
    case "$_profile" in
        minimal|standard|strict) printf '%s' "$_profile" ;;
        *) printf 'standard' ;;
    esac
}

# dhpk_config_bool <key> <default> [override-env]
# Accepts true/false, 1/0, yes/no, and on/off. Invalid values use the default.
dhpk_config_bool() {
    local _key="${1:-}" _default="${2:-false}" _override="${3:-}" _value _fallback
    _value="$(dhpk_config_get "$_key" "$_default" "$_override")"
    case "$_default" in
        1|true|yes|on|TRUE|YES|ON) _fallback="true" ;;
        *) _fallback="false" ;;
    esac
    case "$_value" in
        1|true|TRUE|yes|YES|on|ON) printf 'true' ;;
        0|false|FALSE|no|NO|off|OFF) printf 'false' ;;
        *) printf '%s' "$_fallback" ;;
    esac
}

# dhpk_config_csv <key> <default> [override-env]
# Normalizes comma-separated settings by trimming entries and dropping blanks.
dhpk_config_csv() {
    local _key="${1:-}" _default="${2:-}" _override="${3:-}" _raw _item _out=""
    local _items
    _raw="$(dhpk_config_get "$_key" "$_default" "$_override")"
    [ -n "$_raw" ] || return 0
    IFS=',' read -r -a _items <<< "$_raw"
    for _item in "${_items[@]}"; do
        _item="$(printf '%s' "$_item" | awk '{$1=$1; print}')"
        [ -n "$_item" ] || continue
        if [ -n "$_out" ]; then _out="$_out,$_item"; else _out="$_item"; fi
    done
    printf '%s' "$_out"
}

# Convenience accessors for the most shared runtime options.
dhpk_config_modules() {
    dhpk_config_get modules '' DHPK_ACTIVE_MODULES
}

dhpk_config_review_agents() {
    dhpk_config_csv review_agents ''
}
