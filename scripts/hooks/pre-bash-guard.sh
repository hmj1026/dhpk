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

# Pattern 4: git push with pending review sentinels.
if printf '%s' "$CMD_STRIPPED" | grep -Eq '(^|[[:space:]])git[[:space:]]+push([[:space:]]|$)' && \
   ! printf '%s' "$CMD_STRIPPED" | grep -Eq '(--help|[[:space:]]-h([[:space:]]|$)|--dry-run)'; then
    HOOK_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
    SENTINEL_DIR="$HOOK_ROOT/.claude/artifacts/sessions"
    FOUND_NAMES=""
    FOUND_AGENTS=""
    for i in "${!SENTINEL_NAMES[@]}"; do
        _s="${SENTINEL_NAMES[$i]}"
        if [ -f "$SENTINEL_DIR/$_s" ]; then
            FOUND_NAMES="$FOUND_NAMES $_s"
            FOUND_AGENTS="$FOUND_AGENTS ${SENTINEL_AGENTS[$i]}"
        fi
    done
    if [ -n "$FOUND_NAMES" ]; then
        echo "[bash-guard] blocked: git push while review sentinels pending:$FOUND_NAMES" >&2
        echo "[bash-guard] Pending reviewer(s):$FOUND_AGENTS — run each before pushing." >&2
        exit 2
    fi
fi

exit 0
