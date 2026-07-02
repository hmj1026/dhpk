#!/usr/bin/env bash
# pre-commit-js-validation.sh — JS module PreToolUse Bash hook.
#
# Intercepts `git commit*` commands. When the staged diff includes JS/TS
# files under a configured frontend root, runs `npm run <lint>` and
# `npm run <typecheck>` (script names overridable via userConfig). Failure
# exits 2 (Claude Code rejects the command). The same gate ideally runs in
# CI too; this hook brings the gate forward to commit-time.
#
# Skip mechanisms (in priority order):
#   1. Commit message includes `[skip-js-lint]` (emergency hotfix; needs
#      reviewer justification).
#   2. No staged JS/TS files (no delay for non-JS commits).
#   3. `node_modules/` missing (fail-soft warning; user hasn't run `npm i`).
#
# Timeouts: lint 90s / typecheck 120s (project-wide npm scripts) — a timeout
# is a FAIL like any other, same '[skip-js-lint]' hatch applies.
#
# Script names (defaults in parens):
#   CLAUDE_PLUGIN_OPTION_JS_LINT_SCRIPT       ("lint")
#   CLAUDE_PLUGIN_OPTION_JS_TYPECHECK_SCRIPT  ("typecheck")

set -o pipefail

. "$(dirname "$0")/../../../scripts/hooks/_lib/payload.sh"
. "$(dirname "$0")/_lib/js-tier-detect.sh"

stdin_data="$(cat 2>/dev/null || true)"
[ -z "$stdin_data" ] && exit 0

cmd="$(extract_tool_input command "$stdin_data")"
[ -z "$cmd" ] && exit 0

# Only intercept real `git commit*`; skip plumbing `git commit-tree`.
case "$cmd" in
    *"git commit-tree"*) exit 0 ;;
    *"git commit"*) ;;
    *) exit 0 ;;
esac

if echo "$cmd" | grep -Fq '[skip-js-lint]'; then
    echo "[pre-commit-js] [skip-js-lint] sentinel found in command; bypassing" >&2
    exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    exit 0
fi

staged="$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)"
[ -z "$staged" ] && exit 0

# Filter staged paths through the tier detector — only `frontend` tier files
# trigger the gate. Vendor / non-js paths skip.
_dhpk_js_load_config
has_frontend=0
while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in *.js|*.ts|*.jsx|*.tsx|*.mjs|*.cjs|*.vue|*.svelte) ;; *) continue ;; esac
    detect_js_tier "$f"
    if [ "$JS_TIER" = "frontend" ]; then
        has_frontend=1
        break
    fi
done <<< "$staged"

[ "$has_frontend" -eq 1 ] || exit 0

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root" || exit 0

if [ ! -d node_modules ]; then
    echo "[pre-commit-js] WARN: node_modules missing; skipping lint+typecheck (run 'npm i' to enable gate)" >&2
    exit 0
fi

lint_script="${CLAUDE_PLUGIN_OPTION_JS_LINT_SCRIPT:-lint}"
typecheck_script="${CLAUDE_PLUGIN_OPTION_JS_TYPECHECK_SCRIPT:-typecheck}"

LINT_TIMEOUT_SECS=90
TYPECHECK_TIMEOUT_SECS=120
LINT_TIMEOUT_CMD=""
TYPECHECK_TIMEOUT_CMD=""
if command -v timeout >/dev/null 2>&1; then
    LINT_TIMEOUT_CMD="timeout $LINT_TIMEOUT_SECS"
    TYPECHECK_TIMEOUT_CMD="timeout $TYPECHECK_TIMEOUT_SECS"
fi

echo "[pre-commit-js] staged JS detected; running npm run $lint_script + $typecheck_script..." >&2

$LINT_TIMEOUT_CMD npm run --silent "$lint_script" >&2
rc=$?
if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 124 ]; then
        echo "[pre-commit-js] FAIL: npm run $lint_script timed out after ${LINT_TIMEOUT_SECS}s (possible hang). Investigate or add '[skip-js-lint]' to commit msg." >&2
    else
        echo "[pre-commit-js] FAIL: npm run $lint_script failed. Fix errors or add '[skip-js-lint]' to commit msg." >&2
    fi
    exit 2
fi

$TYPECHECK_TIMEOUT_CMD npm run --silent "$typecheck_script" >&2
rc=$?
if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 124 ]; then
        echo "[pre-commit-js] FAIL: npm run $typecheck_script timed out after ${TYPECHECK_TIMEOUT_SECS}s (possible hang). Investigate or add '[skip-js-lint]' to commit msg." >&2
    else
        echo "[pre-commit-js] FAIL: npm run $typecheck_script failed. Fix errors or add '[skip-js-lint]' to commit msg." >&2
    fi
    exit 2
fi

echo "[pre-commit-js] OK: $lint_script + $typecheck_script passed" >&2
exit 0
