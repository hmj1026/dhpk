#!/usr/bin/env bash
# pre-edit-guard.sh — PreToolUse (Edit|Write|MultiEdit) hook
# Block edits to sensitive paths. Exit code 2 = reject the tool call.
#
# Always blocked:
#   - .env / .env.* (secrets)
#   - .git/ directory (git internals)
#
# Project-extensible:
#   Set GUARD_EXTRA_PATTERNS to add patterns (pipe-separated grep -E regex).
#   Example: GUARD_EXTRA_PATTERNS="src/locales/.*\.json$|generated/.*"
#   WARNING: used as a grep regex. Only set in trusted project config.

set -euo pipefail

. "$(dirname "$0")/_lib/payload.sh"

stdin_data="$(cat 2>/dev/null || true)"
file_path="$(extract_tool_input file_path "$stdin_data")"

[ -z "$file_path" ] && exit 0

# Block paths with shell metacharacters that enable injection.
if [[ "$file_path" =~ [\;\&\|\`] ]] || [[ "$file_path" =~ \$\( ]]; then
    echo "[edit-guard] rejected suspicious file path (shell metacharacters)" >&2
    exit 2
fi

# Block sensitive paths.
if echo "$file_path" | grep -Eq '(\.env(\..*)?$|\.git/)'; then
    echo "[edit-guard] blocked sensitive file: $file_path" >&2
    exit 2
fi

# Project-supplied extra patterns.
if [ -n "${GUARD_EXTRA_PATTERNS:-}" ]; then
    # Validate the regex before applying — avoid grep's exit 2 on bad regex blowing up the hook.
    if echo "" | grep -Eq "$GUARD_EXTRA_PATTERNS" 2>/dev/null || [ $? -le 1 ]; then
        if echo "$file_path" | grep -Eq "$GUARD_EXTRA_PATTERNS"; then
            echo "[edit-guard] blocked by GUARD_EXTRA_PATTERNS: $file_path" >&2
            exit 2
        fi
    else
        echo "[edit-guard] WARN: invalid GUARD_EXTRA_PATTERNS regex, skipping" >&2
    fi
fi

exit 0
