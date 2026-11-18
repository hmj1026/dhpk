#!/usr/bin/env bash
# post-edit-python-lint.sh — Python module PostToolUse (Edit/Write/MultiEdit) hook.
#
# Goal: surface ruff findings for .py edits without waiting for commit / CI.
#
# Two modes (DHPK_PY_LINT_MODE, default "batch"):
#   - batch (default): record the edited path into a per-session accumulator and
#     return immediately. The actual ruff run happens ONCE at Stop via
#     stop-py-batch-check.sh — editing N files lints once at the end, not N times.
#   - per-edit: lint this single file right now (immediate feedback, redundant runs).
#
# Design:
#   - async-friendly: always exit 0; never blocks the edit pipeline. The real
#     gate is the pre-commit hook.
#   - Silent skip when prerequisites are missing (non-.py, no python project dir,
#     no usable ruff). Avoid noise on every edit.
#   - Project root resolved by walking up to the nearest pyproject.toml
#     (hooks/_lib/python-env.sh) so monorepo backends work with zero config.

set -o pipefail

. "$(dirname "$0")/../../../scripts/hooks/_lib/payload.sh"
. "$(dirname "$0")/_lib/python-env.sh"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

PAYLOAD="$(cat 2>/dev/null || true)"
[ -z "$PAYLOAD" ] && exit 0

FILE_PATH="$(extract_tool_input file_path "$PAYLOAD")"
[ -z "$FILE_PATH" ] && FILE_PATH="$(extract_tool_input filePath "$PAYLOAD")"
[ -z "$FILE_PATH" ] && exit 0

case "$FILE_PATH" in
    *.py) ;;
    *) exit 0 ;;
esac
[ -f "$FILE_PATH" ] || exit 0

REL="${FILE_PATH#$ROOT/}"

# Resolve the owning python project dir (and honour PYTHON_PROJECT_ROOTS scope).
PDIR="$(py_project_dir "$FILE_PATH" "$ROOT")"
[ -n "$PDIR" ] || exit 0

# Batch mode (default): accumulate the path and defer the ruff run to Stop.
if [ "${DHPK_PY_LINT_MODE:-batch}" != "per-edit" ]; then
    ACC_DIR="$ROOT/.claude/artifacts/sessions"
    ACC_FILE="$ACC_DIR/.py-pending-check"
    mkdir -p "$ACC_DIR" 2>/dev/null || exit 0
    if [ ! -f "$ACC_FILE" ] || ! grep -Fxq -- "$REL" "$ACC_FILE" 2>/dev/null; then
        printf '%s\n' "$REL" >> "$ACC_FILE" 2>/dev/null || true
    fi
    exit 0
fi

# per-edit mode: lint this single file immediately.
RUFF_BIN="${CLAUDE_PLUGIN_OPTION_RUFF_BIN:-ruff}"
PREFIX="$(py_runner_prefix)"
py_tool_ok "$PDIR" "$PREFIX" "$RUFF_BIN" || exit 0

run_ruff() {
    # $1 = subcommand args (string). Runs inside the project dir.
    if [ -n "$PREFIX" ]; then
        ( cd "$PDIR" && eval "$PREFIX \"$RUFF_BIN\" $1" 2>&1 )
    else
        ( cd "$PDIR" && eval "\"$RUFF_BIN\" $1" 2>&1 )
    fi
}

CHECK_OUT="$(run_ruff "check \"$FILE_PATH\"" || true)"
if echo "$CHECK_OUT" | grep -qE 'Found [0-9]+ error|^[^:]+\.py:[0-9]+:[0-9]+:'; then
    COUNT="$(echo "$CHECK_OUT" | grep -oE 'Found [0-9]+ error[s]?' | head -1)"
    echo "[py-lint] ⚠ ruff ${COUNT:-issues} in $REL (fix before commit)" >&2
    echo "$CHECK_OUT" | grep -E '^[^:]+\.py:[0-9]+:[0-9]+:' | head -5 | sed 's/^/  /' >&2
fi

FMT_OUT="$(run_ruff "format --check \"$FILE_PATH\"" || true)"
if echo "$FMT_OUT" | grep -q 'Would reformat'; then
    echo "[py-lint] ℹ ruff format would reformat $REL — run 'ruff format $REL'" >&2
fi

exit 0
