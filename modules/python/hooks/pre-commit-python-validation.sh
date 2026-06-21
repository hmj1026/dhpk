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
    echo "[pre-commit-py] [skip-python-lint] sentinel found in command; bypassing" >&2
    exit 0
fi

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
ROOT="$(git rev-parse --show-toplevel)"

# Collect non-vendor staged .py files.
staged_py=()
while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in *.py) ;; *) continue ;; esac
    case "$f" in vendor/*|*/vendor/*|.venv/*|*/.venv/*|*/site-packages/*) continue ;; esac
    staged_py+=("$ROOT/$f")
done < <(git -C "$ROOT" diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)

[ "${#staged_py[@]}" -eq 0 ] && exit 0

RUFF_BIN="${CLAUDE_PLUGIN_OPTION_RUFF_BIN:-ruff}"
PREFIX="$(py_runner_prefix)"
TC="${CLAUDE_PLUGIN_OPTION_PYTHON_TYPECHECKER:-pyright}"

# Group staged files by owning project dir.
PDIRS=""
for f in "${staged_py[@]}"; do
    pdir="$(py_project_dir "$f" "$ROOT")"
    [ -n "$pdir" ] || continue
    case ",$PDIRS," in *",$pdir,"*) ;; *) PDIRS="${PDIRS:+$PDIRS,}$pdir" ;; esac
done
[ -n "$PDIRS" ] && echo "[pre-commit-py] ${#staged_py[@]} staged .py file(s) detected; running checks..." >&2

run_tool() {  # <project_dir> <tool_bin> <args-string>
    local pdir="$1" tool="$2" args="$3"
    if [ -n "$PREFIX" ]; then
        ( cd "$pdir" && eval "$PREFIX \"$tool\" $args" >&2 )
    else
        ( cd "$pdir" && eval "\"$tool\" $args" >&2 )
    fi
}

status=0
oldifs="$IFS"; IFS=','
for pdir in $PDIRS; do
    IFS="$oldifs"
    quoted=""
    for f in "${staged_py[@]}"; do
        [ "$(py_project_dir "$f" "$ROOT")" = "$pdir" ] && quoted="$quoted \"$f\""
    done
    [ -z "$quoted" ] && { IFS=','; continue; }

    # 1 + 2. ruff check + format --check. ruff exit codes: 0 = clean, 1 = findings
    # (block the commit), >=2 = internal/config error (WARN only — a broken
    # pyproject.toml or corrupt venv must not masquerade as a lint failure).
    if py_tool_ok "$pdir" "$PREFIX" "$RUFF_BIN"; then
        run_tool "$pdir" "$RUFF_BIN" "check$quoted"; rc=$?
        if [ "$rc" -eq 1 ]; then
            echo "[pre-commit-py] FAIL: ruff check found issues. Run 'ruff check --fix', or add '[skip-python-lint]' to commit msg." >&2
            status=2
        elif [ "$rc" -ge 2 ]; then
            echo "[pre-commit-py] WARN: ruff check exited $rc (internal/config error) — not blocking; fix your ruff config." >&2
        fi
        run_tool "$pdir" "$RUFF_BIN" "format --check$quoted"; rc=$?
        if [ "$rc" -eq 1 ]; then
            echo "[pre-commit-py] FAIL: ruff format --check failed. Run 'ruff format .' or add '[skip-python-lint]'." >&2
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
            if ! run_tool "$pdir" "$tcbin" "."; then
                echo "[pre-commit-py] FAIL: $TC reported type errors. Fix them or add '[skip-python-lint]'." >&2
                status=2
            fi
        fi
    fi
    IFS=','
done
IFS="$oldifs"

[ "$status" -eq 0 ] && echo "[pre-commit-py] OK: all configured checks passed" >&2
exit "$status"
