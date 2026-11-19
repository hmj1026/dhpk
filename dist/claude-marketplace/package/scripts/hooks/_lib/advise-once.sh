#!/usr/bin/env bash
# Source-only. dhpk_advise_once <key> returns 0 once per session/key, 1 after.

. "${BASH_SOURCE[0]%/*}/session-env.sh"

dhpk_advise_once() {
    local key="$1" session="${DHPK_ADVISE_SESSION_ID:-startup}" dir marker line
    dir="$(dhpk_sessions_dir)"
    marker="$dir/.advisories-once"
    line="${session}	${key}"
    mkdir -p "$dir" 2>/dev/null || return 0
    grep -Fqx "$line" "$marker" 2>/dev/null && return 1
    printf '%s\n' "$line" >> "$marker" 2>/dev/null || return 0
    return 0
}
