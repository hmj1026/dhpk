#!/usr/bin/env bash
# pre-commit-python-validation.sh — Python module PreToolUse Bash hook.
#
# Intercepts `git commit*` commands. When the staged diff includes any
# non-vendor `.py` file, runs (per owning project dir, in order):
#
#   1. ruff check          on the staged set
#   2. ruff format --check  on the staged set
#   3. pyright | mypy       project-wide (only when python_typechecker != none)
#
# Any failure exits 2 (Claude Code rejects the bash call). Each tool is silently
# skipped when it is not invokable (no uv/ruff/pyright) — never blocks a project
# that hasn't adopted that tier yet.
#
# Skip mechanisms (priority order):
#   1. Commit message includes `[skip-python-lint]` — emergency hotfix bypass.
#   2. No staged .py files outside vendor/.venv — no gate, no delay.
#   3. No resolvable python project dir (no pyproject.toml) — nothing to run.
#
# Overrides (userConfig → CLAUDE_PLUGIN_OPTION_*): PYTHON_RUNNER, RUFF_BIN,
# PYTHON_TYPECHECKER, PYRIGHT_BIN, MYPY_BIN, PYTHON_PROJECT_ROOTS.

set -o pipefail

. "$(dirname "$0")/../../../scripts/hooks/_lib/payload.sh"
. "$(dirname "$0")/_lib/python-env.sh"

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

if echo "$cmd" | grep -Fq '[skip-python-lint]'; then
    echo "[pre-commit-py] [skip-python-lint] skip marker found in command; bypassing" >&2
    exit 0
fi

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
ROOT="$(git rev-parse --show-toplevel)"

# Collect non-vendor staged .py files. NUL keeps spaces, quotes, and newlines
# as path data; the names are never joined back into a shell command.
staged_py=()
while IFS= read -r -d '' f; do
    [ -z "$f" ] && continue
    case "$f" in *.py) ;; *) continue ;; esac
    case "$f" in vendor/*|*/vendor/*|.venv/*|*/.venv/*|*/site-packages/*) continue ;; esac
    staged_py+=("$ROOT/$f")
done < <(git -C "$ROOT" diff --cached -z --name-only --diff-filter=ACMR 2>/dev/null || true)

[ "${#staged_py[@]}" -eq 0 ] && exit 0

RUFF_BIN="${CLAUDE_PLUGIN_OPTION_RUFF_BIN:-ruff}"
PREFIX="$(py_runner_prefix)"
prefix_rc=$?
if [ "$prefix_rc" -eq 2 ]; then
    echo "[pre-commit-py] FAIL: PYTHON_RUNNER contains shell syntax and was not executed." >&2
    exit 2
fi
TC="${CLAUDE_PLUGIN_OPTION_PYTHON_TYPECHECKER:-pyright}"
RUFF_TIMEOUT_SECS=60
TYPECHECK_TIMEOUT_SECS=120

# Group by the full project directory. A comma or space in that path is data.
pdirs=()
for f in "${staged_py[@]}"; do
    pdir="$(py_project_dir "$f" "$ROOT")"
    [ -n "$pdir" ] || continue
    seen=0
    for existing in "${pdirs[@]}"; do
        [ "$existing" = "$pdir" ] && seen=1 && break
    done
    [ "$seen" -eq 0 ] && pdirs+=("$pdir")
done
[ "${#pdirs[@]}" -gt 0 ] && echo "[pre-commit-py] ${#staged_py[@]} staged .py file(s) detected; running checks..." >&2

# run_tool <project_dir> <tool_bin> <timeout_secs> <argv...>
#   Each path and runner word is one argument. timeout stays a command, not text.
run_tool() {
    local pdir="$1" tool="$2" tsec="$3"
    shift 3
    local -a cmd
    cmd=()
    if command -v timeout >/dev/null 2>&1; then
        cmd+=(timeout "$tsec")
    fi
    if [ -n "$PREFIX" ]; then
        py_runner_words "$PREFIX" || return 2
        cmd+=("${PY_RUNNER_WORDS[@]}")
    fi
    cmd+=("$tool" "$@")
    ( cd "$pdir" && "${cmd[@]}" ) >&2
}

status=0
for pdir in "${pdirs[@]}"; do
    files=()
    for f in "${staged_py[@]}"; do
        [ "$(py_project_dir "$f" "$ROOT")" = "$pdir" ] && files+=("$f")
    done
    [ "${#files[@]}" -eq 0 ] && continue

    # 1 + 2. ruff check + format --check. ruff exit codes: 0 = clean, 1 = findings
    # (block the commit), >=2 = internal/config error (WARN only — a broken
    # pyproject.toml or corrupt venv must not masquerade as a lint failure).
    if py_tool_ok "$pdir" "$PREFIX" "$RUFF_BIN"; then
        run_tool "$pdir" "$RUFF_BIN" "$RUFF_TIMEOUT_SECS" check "${files[@]}"; rc=$?
        if [ "$rc" -eq 1 ]; then
            echo "[pre-commit-py] FAIL: ruff check found issues. Run 'ruff check --fix', or add '[skip-python-lint]' to commit msg." >&2
            status=2
        elif [ "$rc" -eq 124 ]; then
            echo "[pre-commit-py] FAIL: ruff check timed out after ${RUFF_TIMEOUT_SECS}s (possible hang). Investigate or add '[skip-python-lint]'." >&2
            status=2
        elif [ "$rc" -ge 2 ]; then
            echo "[pre-commit-py] WARN: ruff check exited $rc (internal/config error) — not blocking; fix your ruff config." >&2
        fi
        run_tool "$pdir" "$RUFF_BIN" "$RUFF_TIMEOUT_SECS" format --check "${files[@]}"; rc=$?
        if [ "$rc" -eq 1 ]; then
            echo "[pre-commit-py] FAIL: ruff format --check failed. Run 'ruff format .' or add '[skip-python-lint]'." >&2
            status=2
        elif [ "$rc" -eq 124 ]; then
            echo "[pre-commit-py] FAIL: ruff format --check timed out after ${RUFF_TIMEOUT_SECS}s (possible hang). Investigate or add '[skip-python-lint]'." >&2
            status=2
        elif [ "$rc" -ge 2 ]; then
            echo "[pre-commit-py] WARN: ruff format exited $rc (internal/config error) — not blocking." >&2
        fi
    else
        echo "[pre-commit-py] WARN: ruff not invokable under ${pdir#$ROOT/} (runner='${PREFIX:-PATH}') — style gate skipped" >&2
    fi

    # 3. type checker (project-wide)
    if [ "$TC" != "none" ]; then
        case "$TC" in
            pyright) tcbin="${CLAUDE_PLUGIN_OPTION_PYRIGHT_BIN:-pyright}" ;;
            mypy)    tcbin="${CLAUDE_PLUGIN_OPTION_MYPY_BIN:-mypy}" ;;
            *)       tcbin="" ;;
        esac
        if [ -n "$tcbin" ] && py_tool_ok "$pdir" "$PREFIX" "$tcbin"; then
            run_tool "$pdir" "$tcbin" "$TYPECHECK_TIMEOUT_SECS" .; rc=$?
            if [ "$rc" -eq 124 ]; then
                echo "[pre-commit-py] FAIL: $TC timed out after ${TYPECHECK_TIMEOUT_SECS}s (possible hang). Investigate or add '[skip-python-lint]'." >&2
                status=2
            elif [ "$rc" -ne 0 ]; then
                echo "[pre-commit-py] FAIL: $TC reported type errors. Fix them or add '[skip-python-lint]'." >&2
                status=2
            fi
        fi
    fi
done

[ "$status" -eq 0 ] && echo "[pre-commit-py] OK: all configured checks passed" >&2
exit "$status"
