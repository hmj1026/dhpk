#!/usr/bin/env bash
# statusline.sh — dhpk plugin statusline (project-side)
#
# This script is NOT wired automatically (Claude Code plugin spec has no
# statusline component). Projects opt in by adding to their settings.json:
#   "statusLine": {
#     "type": "command",
#     "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/statusline/statusline.sh"
#   }
#
# Output: prepends a dhpk line, then calls the global ~/.claude/statusline.sh
# (with cwd removed so it skips its own git section).

set -o pipefail

. "$(dirname "$0")/../hooks/_lib/payload.sh"

input="$(cat 2>/dev/null || true)"

# Global statusline (rich: model, tokens, effort, rate limit).
base_line=""
if [ -x "$HOME/.claude/statusline.sh" ]; then
    if command -v jq >/dev/null 2>&1; then
        base_line="$(printf '%s' "$input" | jq -c 'del(.cwd)' 2>/dev/null | bash "$HOME/.claude/statusline.sh" 2>/dev/null)"
    else
        base_line="$(printf '%s' "$input" | bash "$HOME/.claude/statusline.sh" 2>/dev/null)"
    fi
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PROFILE="${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-standard}"

BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null)"
[ -z "$BRANCH" ] && BRANCH="(detached)"

STAGED="$(git -C "$ROOT" diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"
MODIFIED="$(git -C "$ROOT" diff --name-only 2>/dev/null | wc -l | tr -d ' ')"

# Docker (only if containers configured).
DOCKER_STR=""
if [ -n "${CLAUDE_PLUGIN_OPTION_DOCKER_CONTAINERS:-}" ] && command -v docker >/dev/null 2>&1; then
    NAMES="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
    IFS=',' read -r -a _containers <<< "${CLAUDE_PLUGIN_OPTION_DOCKER_CONTAINERS}"
    _ok=0
    _total=0
    for _c in "${_containers[@]}"; do
        _c="$(echo "$_c" | xargs)"
        [ -z "$_c" ] && continue
        _total=$((_total + 1))
        echo "$NAMES" | grep -q "^${_c}$" && _ok=$((_ok + 1))
    done
    if [ "$_total" -gt 0 ]; then
        if [ "$_ok" -eq "$_total" ]; then
            DOCKER_STR=" | docker:ok"
        elif [ "$_ok" -eq 0 ]; then
            DOCKER_STR=" | docker:down"
        else
            DOCKER_STR=" | docker:${_ok}/${_total}"
        fi
    fi
fi

# Modules.
MODULES_STR=""
if [ -n "${DHPK_ACTIVE_MODULES:-}" ]; then
    MODULES_STR=" | mod=${DHPK_ACTIVE_MODULES}"
fi

# Sentinel badge — short labels parallel SENTINEL_NAMES.
SENTINEL_BADGE=""
SESS="$ROOT/.claude/artifacts/sessions"
SHORT=("code" "db" "sec" "fe" "doc")
if [ -d "$SESS" ] && [ "${#SHORT[@]}" -eq "${#SENTINEL_NAMES[@]}" ]; then
    PENDING=()
    for i in "${!SENTINEL_NAMES[@]}"; do
        [ -f "$SESS/${SENTINEL_NAMES[$i]}" ] && PENDING+=("${SHORT[$i]}")
    done
    if [ "${#PENDING[@]}" -gt 0 ]; then
        SENTINEL_BADGE=" | ⚠ $(IFS='|'; echo "${PENDING[*]}")"
    fi
fi

prefix="[$BRANCH] +$STAGED ~$MODIFIED${DOCKER_STR} | profile=${PROFILE}${MODULES_STR}${SENTINEL_BADGE}"
if [ -n "$base_line" ]; then
    printf '%s\n%s' "$prefix" "$base_line"
else
    printf '%s' "$prefix"
fi
