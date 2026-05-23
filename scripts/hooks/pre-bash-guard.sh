#!/usr/bin/env bash
# pre-bash-guard.sh — PreToolUse (Bash) hook
# Block dangerous bash patterns. Exit 2 rejects the call.
#
# Patterns:
#   1. rm -rf on root/system dirs (whitelist of known-dangerous top-level dirs)
#   2. Curl/wget piped to shell (typical supply-chain attack)
#   3. chmod 777/666 (almost always a mistake)
#   4. git push while review sentinels exist (enforces review-before-push policy)
#
# Project-extensible:
#   - Add patterns by editing this file or via a downstream hook.

set -o pipefail

. "$(dirname "$0")/_lib/payload.sh"

PAYLOAD="$(cat 2>/dev/null || true)"
CMD="$(extract_tool_input command "$PAYLOAD")"
[ -z "$CMD" ] && exit 0

# Strip shell comments before matching — avoids false-positives on text after `#`.
CMD_STRIPPED="$(printf '%s' "$CMD" | sed 's/[[:space:]]*#.*//')"

# Pattern 1: rm -rf on root or sensitive top-level dirs.
# Whitelist approach: only block known-dangerous targets to avoid false-positives
# on /tmp, /var/tmp, /var/log cleanups.
DANGEROUS_ROOT='(etc|usr|bin|sbin|lib|lib64|boot|proc|sys|dev|run|root|home|opt|srv|snap)'
if printf '%s' "$CMD_STRIPPED" | grep -Eq \
    "(^|[[:space:];&|])rm[[:space:]]+(-[a-zA-Z]+[[:space:]]+)+(--[[:space:]]+)?/([[:space:]\$\*]|$|${DANGEROUS_ROOT}([/[:space:]]|$))"; then
    echo "[bash-guard] blocked: rm -rf against root or system directory. Narrow the path or run outside Claude." >&2
    exit 2
fi

# Pattern 2: curl|sh / wget|bash / fetch|zsh family.
if printf '%s' "$CMD_STRIPPED" | grep -Eq '(curl|wget|fetch)[^|]*\|[[:space:]]*(sh|bash|zsh|ksh)([[:space:]]|$|;|\|)'; then
    echo "[bash-guard] blocked: piping remote download into shell. Save to file, inspect, then run." >&2
    exit 2
fi

# Pattern 3: chmod 777 / 666 (including -R777 etc).
if printf '%s' "$CMD_STRIPPED" | grep -Eq '(^|[[:space:];&|])chmod[[:space:]]+(-[a-zA-Z]*[[:space:]]*)?[0-7]?(777|666)([[:space:]]|$)'; then
    echo "[bash-guard] blocked: chmod 777/666. Use stricter perms (750/640) or narrower paths." >&2
    exit 2
fi

# Pattern 4: git push with pending review sentinels — only block when at
# least one sentinel-listed path is actually uncommitted-or-staged. Stale
# sentinels from already-committed work do NOT block: once HEAD moves past
# them, `git diff --name-only HEAD` no longer reports those paths.
#
# 60-min TTL auto-clear runs first (delegated to reap-stale-sentinels.sh
# --clear) so leaked sentinels from crashed reviewers don't accumulate.
if printf '%s' "$CMD_STRIPPED" | grep -Eq '(^|[[:space:]])git[[:space:]]+push([[:space:]]|$)' && \
   ! printf '%s' "$CMD_STRIPPED" | grep -Eq '(--help|[[:space:]]-h([[:space:]]|$)|--dry-run)'; then
    HOOK_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
    SENTINEL_DIR="$HOOK_ROOT/.claude/artifacts/sessions"

    # Auto-clear sentinels older than 60 min (delegated; see reap-stale-sentinels.sh).
    CLAUDE_PROJECT_DIR="$HOOK_ROOT" bash "$(dirname "$0")/reap-stale-sentinels.sh" \
        --threshold-minutes 60 --clear 2>/dev/null || true

    # Build the set of paths git considers locally-changed against HEAD.
    # Includes both unstaged (`diff HEAD`) and staged-not-yet-committed
    # (`diff --cached`). After commit, files drop out — sentinel intersection
    # comes up empty, push is allowed.
    UNCOMMITTED="$(
        { git -C "$HOOK_ROOT" diff --name-only HEAD 2>/dev/null
          git -C "$HOOK_ROOT" diff --name-only --cached 2>/dev/null
        } | sort -u
    )"

    FOUND_NAMES=""
    FOUND_AGENTS=""
    for i in "${!SENTINEL_NAMES[@]}"; do
        _s="${SENTINEL_NAMES[$i]}"
        _sf="$SENTINEL_DIR/$_s"
        [ -f "$_sf" ] || continue
        # cut -d' ' -f3- drops the "YYYY-MM-DD HH:MM:SS " prefix; sort -u
        # dedupes in case of pre-fix legacy sentinels with duplicate lines.
        _sentinel_paths="$(cut -d' ' -f3- "$_sf" 2>/dev/null | sort -u)"
        [ -z "$_sentinel_paths" ] && continue
        _match=0
        while IFS= read -r _p; do
            [ -z "$_p" ] && continue
            if printf '%s\n' "$UNCOMMITTED" | grep -Fxq -- "$_p"; then
                _match=1
                break
            fi
        done <<< "$_sentinel_paths"
        if [ "$_match" -eq 1 ]; then
            FOUND_NAMES="$FOUND_NAMES $_s"
            FOUND_AGENTS="$FOUND_AGENTS ${SENTINEL_AGENTS[$i]}"
        fi
    done
    if [ -n "$FOUND_NAMES" ]; then
        echo "[bash-guard] blocked: git push while uncommitted edits await review:$FOUND_NAMES" >&2
        echo "[bash-guard] Pending reviewer(s):$FOUND_AGENTS — run each before pushing." >&2
        exit 2
    fi
fi

exit 0
