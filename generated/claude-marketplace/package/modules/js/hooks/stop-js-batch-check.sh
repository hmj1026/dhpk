#!/usr/bin/env bash
# stop-js-batch-check.sh — JS module Stop hook (fired via stop-advisory-dispatch.sh).
#
# Batches the JS/TS quality feedback that post-edit-js-lint.sh deferred: run
# ESLint ONCE over every frontend file edited during this response, instead of
# once per edit. Pairs with the "batch" mode of post-edit-js-lint.sh.
#
# Design:
#   - Advisory only: always exit 0. Never blocks Stop. (The real gate is the
#     pre-commit hook.)
#   - No-op in per-edit mode (the accumulator is never written there).
#   - Optional whole-project typecheck behind DHPK_JS_STOP_TYPECHECK=1 (off by
#     default — `tsc` is project-wide and would make every Stop slow; the
#     pre-commit gate still runs it).
#   - Clears the accumulator when done so the next response starts clean.

set -o pipefail

. "$(dirname "$0")/_lib/js-tier-detect.sh" 2>/dev/null || true

[ "${DHPK_JS_LINT_MODE:-batch}" != "per-edit" ] || exit 0

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ACC_FILE="$ROOT/.claude/artifacts/sessions/.js-pending-check"

[ -f "$ACC_FILE" ] || exit 0

# Collect still-existing accumulated paths (a file edited then deleted/renamed
# this response should not error the batch).
PATHS=()
while IFS= read -r _p; do
    [ -z "$_p" ] && continue
    [ -f "$ROOT/$_p" ] && PATHS+=("$_p")
done < "$ACC_FILE"

# Clear early — accumulator is consumed regardless of whether ESLint runs. All
# subsequent guard-exits (npx missing, eslint config missing) still leave a clean
# slate for the next response.
rm -f "$ACC_FILE" 2>/dev/null || true

[ "${#PATHS[@]}" -gt 0 ] || exit 0

command -v npx >/dev/null 2>&1 || exit 0
[ -f "$ROOT/eslint.config.js" ] || [ -f "$ROOT/eslint.config.mjs" ] || [ -f "$ROOT/eslint.config.cjs" ] || exit 0

cd "$ROOT" || exit 0

if command -v timeout >/dev/null 2>&1; then
    OUTPUT="$(timeout 30 npx --no-install eslint "${PATHS[@]}" 2>&1 || true)"
else
    OUTPUT="$(npx --no-install eslint "${PATHS[@]}" 2>&1 || true)"
fi

if echo "$OUTPUT" | grep -qE '^\s*[0-9]+\s+problems?\s*\(|✖ [0-9]+\s+problems?'; then
    COUNT="$(echo "$OUTPUT" | grep -oE '[0-9]+ problems?' | tail -1)"
    echo "[js-lint] ⚠ ESLint ${COUNT:-issues} across ${#PATHS[@]} edited file(s) this response (fix before commit)" >&2
    echo "$OUTPUT" | grep -E '^\s+[0-9]+:[0-9]+\s+(error|warning)' | head -10 | sed 's/^/  /' >&2
elif echo "$OUTPUT" | grep -q 'Parsing error\|Cannot find module'; then
    echo "[js-lint] WARN: eslint could not parse one of the edited files (parser/config issue — silent skip)" >&2
fi

# Optional whole-project typecheck (off by default — see header).
if [ "${DHPK_JS_STOP_TYPECHECK:-0}" = "1" ]; then
    TC_SCRIPT="${CLAUDE_PLUGIN_OPTION_JS_TYPECHECK_SCRIPT:-typecheck}"
    if [ -f "$ROOT/package.json" ] && grep -Eq "\"$TC_SCRIPT\"[[:space:]]*:" "$ROOT/package.json" 2>/dev/null; then
        if ! npm run --silent "$TC_SCRIPT" >/dev/null 2>&1; then
            echo "[js-lint] ⚠ typecheck ('npm run $TC_SCRIPT') reported errors (fix before commit)" >&2
        fi
    fi
fi

exit 0
