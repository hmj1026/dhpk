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
. "$(dirname "$0")/../../../scripts/hooks/_lib/command-inspect.sh"
. "$(dirname "$0")/../../../scripts/hooks/_lib/portable-timeout.sh"
. "$(dirname "$0")/_lib/js-tier-detect.sh"

stdin_data="$(cat 2>/dev/null || true)"
[ -z "$stdin_data" ] && exit 0

cmd="$(extract_tool_input command "$stdin_data")"
[ -z "$cmd" ] && exit 0

dhpk_inspect_command "$cmd"
dhpk_load_commit_roots '[skip-js-lint]' 'pre-commit-js' || exit 0

js_check_root() {
local ROOT="$1"
cd "$ROOT" || return 0

# NUL records keep quoted and newline paths intact. Only frontend-tier files open the gate.
staged_js=()
while IFS= read -r -d '' f; do
    [ -z "$f" ] && continue
    case "$f" in *.js|*.ts|*.jsx|*.tsx|*.mjs|*.cjs|*.vue|*.svelte) ;; *) continue ;; esac
    detect_js_tier "$f"
    if [ "$JS_TIER" = "frontend" ]; then
        staged_js+=("$f")
    fi
done < <(git -C "$ROOT" diff --cached -z --name-only --diff-filter=ACMR 2>/dev/null || true)

[ "${#staged_js[@]}" -eq 0 ] && return 0

if [ ! -d node_modules ]; then
    echo "[pre-commit-js] WARN: node_modules missing; skipping lint+typecheck (run 'npm i' to enable gate)" >&2
    return 0
fi

lint_script="${CLAUDE_PLUGIN_OPTION_JS_LINT_SCRIPT:-lint}"
typecheck_script="${CLAUDE_PLUGIN_OPTION_JS_TYPECHECK_SCRIPT:-typecheck}"

LINT_TIMEOUT_SECS=90
TYPECHECK_TIMEOUT_SECS=120

echo "[pre-commit-js] staged JS detected; running npm run $lint_script + $typecheck_script..." >&2

run_with_timeout "$LINT_TIMEOUT_SECS" npm run --silent "$lint_script" >&2
rc=$?
if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 124 ]; then
        echo "[pre-commit-js] FAIL: npm run $lint_script timed out after ${LINT_TIMEOUT_SECS}s (possible hang). Investigate or add '[skip-js-lint]' to commit msg." >&2
    elif [ "$rc" -eq 125 ]; then
        echo "[pre-commit-js] FAIL: deadline unavailable; npm run $lint_script was not started." >&2
    else
        echo "[pre-commit-js] FAIL: npm run $lint_script failed. Fix errors or add '[skip-js-lint]' to commit msg." >&2
    fi
    return 2
fi

run_with_timeout "$TYPECHECK_TIMEOUT_SECS" npm run --silent "$typecheck_script" >&2
rc=$?
if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 124 ]; then
        echo "[pre-commit-js] FAIL: npm run $typecheck_script timed out after ${TYPECHECK_TIMEOUT_SECS}s (possible hang). Investigate or add '[skip-js-lint]' to commit msg." >&2
    elif [ "$rc" -eq 125 ]; then
        echo "[pre-commit-js] FAIL: deadline unavailable; npm run $typecheck_script was not started." >&2
    else
        echo "[pre-commit-js] FAIL: npm run $typecheck_script failed. Fix errors or add '[skip-js-lint]' to commit msg." >&2
    fi
    return 2
fi

echo "[pre-commit-js] OK: $lint_script + $typecheck_script passed" >&2
return 0
}

js_status=0
for ROOT in "${DHPK_COMMIT_ROOTS[@]}"; do
    js_check_root "$ROOT" || js_status=$?
done
exit "$js_status"
