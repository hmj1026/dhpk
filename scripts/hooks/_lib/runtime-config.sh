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

# Internal dynamic-environment helpers. Names passed here are assembled from
# fixed option keys above; they are never user-controlled shell fragments.
_dhpk_var_present() {
    local _name="${1:-}" _present=""
    [ -n "$_name" ] || return 1
    eval "_present=\${${_name}+x}"
    [ "$_present" = "x" ]
}

_dhpk_var_value() {
    local _name="${1:-}" _value=""
    [ -n "$_name" ] || return 0
    eval "_value=\${${_name}-}"
    printf '%s' "$_value"
}

# Normalize an unsigned decimal timeout without arithmetic expansion. Bash
# treats leading-zero literals as octal, and very large operator values should
# still be rejected/diagnosed deterministically rather than triggering an
# arithmetic parse error in a hook.
_dhpk_codex_timeout_normalize() {
    local _value="${1:-}"
    case "$_value" in
        ''|*[!0-9]*) return 1 ;;
    esac
    while [ "$_value" != "0" ] && [ "${_value#0}" != "$_value" ]; do
        _value="${_value#0}"
    done
    printf '%s' "$_value"
}

_dhpk_codex_timeout_compare() {
    local _left="${1:-0}" _right="${2:-0}"
    if [ "${#_left}" -lt "${#_right}" ]; then
        printf '%s' '-1'
    elif [ "${#_left}" -gt "${#_right}" ]; then
        printf '%s' '1'
    elif [ "$_left" = "$_right" ]; then
        printf '%s' '0'
    elif [[ "$_left" < "$_right" ]]; then
        printf '%s' '-1'
    else
        printf '%s' '1'
    fi
}

_dhpk_codex_timeout_half() {
    local _value="${1:-0}" _result="" _carry=0 _digit="" _digit_value=0 _number=0 _quotient=0 _i=0
    for (( _i=0; _i<${#_value}; _i++ )); do
        _digit="${_value:_i:1}"
        case "$_digit" in
            0) _digit_value=0 ;; 1) _digit_value=1 ;; 2) _digit_value=2 ;;
            3) _digit_value=3 ;; 4) _digit_value=4 ;; 5) _digit_value=5 ;;
            6) _digit_value=6 ;; 7) _digit_value=7 ;; 8) _digit_value=8 ;;
            9) _digit_value=9 ;; *) return 1 ;;
        esac
        _number=$((_carry * 10 + _digit_value))
        _quotient=$((_number / 2))
        _carry=$((_number % 2))
        _result="${_result}${_quotient}"
    done
    while [ "${#_result}" -gt 1 ] && [ "${_result#0}" != "$_result" ]; do
        _result="${_result#0}"
    done
    printf '%s' "${_result:-0}"
}

_dhpk_codex_timeout_outer_status() {
    local _inner="${1:-0}" _outer="" _normalized="" _comparison=""
    if ! _dhpk_var_present DHPK_OUTER_BUDGET_SECS; then
        printf '%s' 'outer_budget=unknown'
        return 0
    fi
    _outer="$(_dhpk_var_value DHPK_OUTER_BUDGET_SECS)"
    if ! _normalized="$(_dhpk_codex_timeout_normalize "$_outer")"; then
        printf '%s' 'outer_budget=unknown warning=invalid_outer_budget'
        return 0
    fi
    _comparison="$(_dhpk_codex_timeout_compare "$_normalized" "$_inner")"
    if [ "$_comparison" -le 0 ]; then
        printf 'outer_budget=%s warning=outer_budget_not_longer_than_inner' "$_normalized"
    else
        printf 'outer_budget=%s aligned' "$_normalized"
    fi
}

# _dhpk_codex_timeout_role <requested-role> [mode]
# Translate the one-release aliases at the timeout boundary. The bridge alias
# has no fixed authority, so it requires an explicit mode rather than guessing.
_dhpk_codex_timeout_role() {
    local _requested="${1:-}" _mode="${2:-}" _effective="" _authority=""
    case "$_requested" in
        codex-fast-worker) _effective='codex-worker'; _authority='workspace-write' ;;
        codex-deep-reasoner) _effective='codex-reasoner'; _authority='read-only' ;;
        codex-worker) _effective='codex-worker'; _authority='workspace-write' ;;
        codex-reasoner) _effective='codex-reasoner'; _authority='read-only' ;;
        codex-reviewer) _effective='codex-reviewer'; _authority='read-only' ;;
        codex-bridge)
            case "$_mode" in
                read-only) _effective='codex-reviewer'; _authority='read-only' ;;
                workspace-write) _effective='codex-worker'; _authority='workspace-write' ;;
                *)
                    printf 'runtime-config: codex-bridge requires an explicit mode (read-only or workspace-write)\n' >&2
                    return 78
                    ;;
            esac
            ;;
        *)
            printf 'runtime-config: unknown Codex role %s; refusing to guess a timeout budget\n' "${_requested:-<empty>}" >&2
            return 78
            ;;
    esac
    if [ -n "$_mode" ] && [ "$_mode" != "$_authority" ]; then
        printf 'runtime-config: Codex role %s contradicts mode %s\n' "$_requested" "$_mode" >&2
        return 78
    fi
    printf '%s' "$_effective"
}

# dhpk_codex_timeout_export <role> [read-only|workspace-write]
# Resolve and export the effective timeout for a Codex role. Scope precedence
# is intentionally project-first (role > shared), then global (role > shared),
# then the shipped 360-second default. CODEX_WRAP_TIMEOUT_SECS is a validated
# highest-precedence compatibility/test override; a present-but-empty value is
# malformed and therefore fails closed.
dhpk_codex_timeout_export() {
    local _requested_role="${1:-${DHPK_CODEX_ROLE:-}}" _mode="${2:-}" _role="" _role_key="" _legacy_role_key="" _upper="" _legacy_upper=""
    local _project_role="" _project_legacy_role="" _project_shared="" _global_role="" _global_legacy_role="" _global_shared=""
    local _value="" _source="default" _normalized="" _outer_status=""
    if ! _role="$(_dhpk_codex_timeout_role "$_requested_role" "$_mode")"; then
        return 78
    fi
    case "$_role" in
        codex-worker)        _role_key='codex_worker_timeout_secs'; _legacy_role_key='codex_fast_worker_timeout_secs' ;;
        codex-reasoner)      _role_key='codex_reasoner_timeout_secs'; _legacy_role_key='codex_deep_reasoner_timeout_secs' ;;
        codex-reviewer)      _role_key='codex_reviewer_timeout_secs'; _legacy_role_key='codex_bridge_timeout_secs' ;;
    esac
    _upper="$(printf '%s' "$_role_key" | tr '[:lower:]' '[:upper:]')"
    _legacy_upper="$(printf '%s' "$_legacy_role_key" | tr '[:lower:]' '[:upper:]')"
    _project_role="DHPK_PROJECT_OPTION_${_upper}"
    _project_legacy_role="DHPK_PROJECT_OPTION_${_legacy_upper}"
    _project_shared='DHPK_PROJECT_OPTION_CODEX_TIMEOUT_SECS'
    _global_role="CLAUDE_PLUGIN_OPTION_${_upper}"
    _global_legacy_role="CLAUDE_PLUGIN_OPTION_${_legacy_upper}"
    _global_shared='CLAUDE_PLUGIN_OPTION_CODEX_TIMEOUT_SECS'

    if _dhpk_var_present CODEX_WRAP_TIMEOUT_SECS; then
        _value="$(_dhpk_var_value CODEX_WRAP_TIMEOUT_SECS)"
        _source='env:CODEX_WRAP_TIMEOUT_SECS'
    elif _dhpk_var_present "$_project_role"; then
        _value="$(_dhpk_var_value "$_project_role")"
        _source="project:${_role_key}"
    elif _dhpk_var_present "$_project_legacy_role"; then
        _value="$(_dhpk_var_value "$_project_legacy_role")"
        _source="project:${_legacy_role_key}"
    elif _dhpk_var_present "$_project_shared"; then
        _value="$(_dhpk_var_value "$_project_shared")"
        _source='project:codex_timeout_secs'
    elif _dhpk_var_present "$_global_role"; then
        _value="$(_dhpk_var_value "$_global_role")"
        _source="global:${_role_key}"
    elif _dhpk_var_present "$_global_legacy_role"; then
        _value="$(_dhpk_var_value "$_global_legacy_role")"
        _source="global:${_legacy_role_key}"
    elif _dhpk_var_present "$_global_shared"; then
        _value="$(_dhpk_var_value "$_global_shared")"
        _source='global:codex_timeout_secs'
    else
        _value='360'
    fi

    if ! _normalized="$(_dhpk_codex_timeout_normalize "$_value")"; then
        printf 'runtime-config: invalid Codex timeout value %s from %s; expected an integer number of seconds >= 0 (0 disables the backstop)\n' \
            "${_value:-<empty>}" "$_source" >&2
        return 78
    fi
    _outer_status="$(_dhpk_codex_timeout_outer_status "$_normalized")"
    export DHPK_CODEX_REQUESTED_ROLE="$_requested_role"
    export DHPK_CODEX_EFFECTIVE_ROLE="$_role"
    export DHPK_CODEX_ROLE="$_role"
    export DHPK_CODEX_TIMEOUT_SECS="$_normalized"
    export DHPK_CODEX_TIMEOUT_SOURCE="$_source"
    export DHPK_CODEX_TIMEOUT_DISABLED=false
    if [ "$_normalized" = '0' ]; then
        export DHPK_CODEX_TIMEOUT_DISABLED=true
    fi
    export DHPK_CODEX_OUTER_BUDGET_STATUS="$_outer_status"
    export DHPK_CODEX_TIMEOUT_RESOLVED=true
    return 0
}

# dhpk_codex_timeout_export_resolved <role> <validated-budget> [source]
# Consume a tuple resolved by a dispatcher/agent. This keeps the caller's
# provenance intact while applying the same validation and outer-budget status
# calculation as a fresh config lookup.
dhpk_codex_timeout_export_resolved() {
    local _role="${1:-}" _value="${2:-}" _source="${3:-caller}" _role_key="" _normalized="" _outer_status=""
    case "$_role" in
        codex-worker)        _role_key='codex_worker_timeout_secs' ;;
        codex-reasoner)      _role_key='codex_reasoner_timeout_secs' ;;
        codex-reviewer)      _role_key='codex_reviewer_timeout_secs' ;;
        *)
            printf 'runtime-config: unknown Codex role %s; refusing a propagated timeout budget\n' "${_role:-<empty>}" >&2
            return 78
            ;;
    esac
    if ! _normalized="$(_dhpk_codex_timeout_normalize "$_value")"; then
        printf 'runtime-config: invalid propagated Codex timeout value %s from %s; expected an integer number of seconds >= 0 (0 disables the backstop)\n' \
            "${_value:-<empty>}" "$_source" >&2
        return 78
    fi
    _outer_status="$(_dhpk_codex_timeout_outer_status "$_normalized")"
    unset DHPK_CODEX_REQUESTED_ROLE
    export DHPK_CODEX_EFFECTIVE_ROLE="$_role"
    export DHPK_CODEX_ROLE="$_role"
    export DHPK_CODEX_TIMEOUT_SECS="$_normalized"
    export DHPK_CODEX_TIMEOUT_SOURCE="$_source"
    export DHPK_CODEX_TIMEOUT_DISABLED=false
    if [ "$_normalized" = '0' ]; then
        export DHPK_CODEX_TIMEOUT_DISABLED=true
    fi
    export DHPK_CODEX_OUTER_BUDGET_STATUS="$_outer_status"
    export DHPK_CODEX_TIMEOUT_RESOLVED=true
    return 0
}

# Convenience accessors for the most shared runtime options.
dhpk_config_modules() {
    dhpk_config_get modules '' DHPK_ACTIVE_MODULES
}

dhpk_config_review_agents() {
    dhpk_config_csv review_agents ''
}
