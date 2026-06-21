#!/usr/bin/env bash
# stop-py-batch-check.sh — Python module Stop hook (fired via stop-dispatch.sh).
#
# Batches the ruff feedback that post-edit-python-lint.sh deferred: run ruff ONCE
# over every .py file edited during this response, instead of once per edit.
# Pairs with the "batch" mode (default) of post-edit-python-lint.sh.
#
# Design:
#   - Advisory only: always exit 0. Never blocks Stop. (The real gate is the
#     pre-commit hook.)
#   - No-op in per-edit mode (the accumulator is never written there).
#   - Files are grouped by their owning python project dir, so a monorepo with
#     several pyproject.toml subtrees lints each in its own env.
#   - Optional whole-project typecheck behind DHPK_PY_STOP_TYPECHECK=1 (off by
#     default — type-checking is project-wide and would make every Stop slow;
#     the pre-commit gate still runs it).
#   - Clears the accumulator when done so the next response starts clean.

set -o pipefail

. "$(dirname "$0")/_lib/python-env.sh" 2>/dev/null || true

[ "${DHPK_PY_LINT_MODE:-batch}" != "per-edit" ] || exit 0

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ACC_FILE="$ROOT/.claude/artifacts/sessions/.py-pending-check"
[ -f "$ACC_FILE" ] || exit 0

RUFF_BIN="${CLAUDE_PLUGIN_OPTION_RUFF_BIN:-ruff}"
PREFIX="$(py_runner_prefix)"

# Collect still-existing accumulated files, grouped by project dir.
# bash 3.2: no associative arrays — track unique project dirs in a plain list.
PDIRS=""
FILES=()
while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    abs="$ROOT/$rel"
    [ -f "$abs" ] || continue
    FILES+=("$abs")
done < "$ACC_FILE"

# Clear the accumulator up front so a mid-run error never leaves stale state.
: > "$ACC_FILE" 2>/dev/null || true

[ "${#FILES[@]}" -eq 0 ] && exit 0

# Build the unique project-dir set.
for f in "${FILES[@]}"; do
    pdir="$(py_project_dir "$f" "$ROOT")"
    [ -n "$pdir" ] || continue
    case ",$PDIRS," in
        *",$pdir,"*) ;;
        *) PDIRS="${PDIRS:+$PDIRS,}$pdir" ;;
    esac
done
[ -n "$PDIRS" ] || exit 0

run_tool() {  # <project_dir> <tool_bin> <args-string>
    local pdir="$1" tool="$2" args="$3"
    if [ -n "$PREFIX" ]; then
        ( cd "$pdir" && eval "$PREFIX \"$tool\" $args" 2>&1 )
    else
        ( cd "$pdir" && eval "\"$tool\" $args" 2>&1 )
    fi
}

oldifs="$IFS"; IFS=','
for pdir in $PDIRS; do
    IFS="$oldifs"
    # Files belonging to this project dir.
    set --
    for f in "${FILES[@]}"; do
        [ "$(py_project_dir "$f" "$ROOT")" = "$pdir" ] && set -- "$@" "$f"
    done
    [ "$#" -eq 0 ] && { IFS=','; continue; }

    if py_tool_ok "$pdir" "$PREFIX" "$RUFF_BIN"; then
        quoted=""
        for f in "$@"; do quoted="$quoted \"$f\""; done
        CHECK_OUT="$(run_tool "$pdir" "$RUFF_BIN" "check$quoted" || true)"
        if echo "$CHECK_OUT" | grep -qE 'Found [0-9]+ error|^[^:]+\.py:[0-9]+:[0-9]+:'; then
            COUNT="$(echo "$CHECK_OUT" | grep -oE 'Found [0-9]+ error[s]?' | head -1)"
            echo "[py-lint] ⚠ ruff ${COUNT:-issues} across edited file(s) under ${pdir#$ROOT/}" >&2
            echo "$CHECK_OUT" | grep -E '^[^:]+\.py:[0-9]+:[0-9]+:' | head -8 | sed 's/^/  /' >&2
        fi
        FMT_OUT="$(run_tool "$pdir" "$RUFF_BIN" "format --check$quoted" || true)"
        if echo "$FMT_OUT" | grep -q 'Would reformat'; then
            echo "[py-lint] ℹ ruff format would reformat some edited file(s) — run 'ruff format .'" >&2
        fi
    fi

    if [ "${DHPK_PY_STOP_TYPECHECK:-0}" = "1" ]; then
        tc="${CLAUDE_PLUGIN_OPTION_PYTHON_TYPECHECKER:-pyright}"
        case "$tc" in
            pyright) tcbin="${CLAUDE_PLUGIN_OPTION_PYRIGHT_BIN:-pyright}" ;;
            mypy)    tcbin="${CLAUDE_PLUGIN_OPTION_MYPY_BIN:-mypy}" ;;
            *)       tcbin="" ;;
        esac
        if [ -n "$tcbin" ] && py_tool_ok "$pdir" "$PREFIX" "$tcbin"; then
            TC_OUT="$(run_tool "$pdir" "$tcbin" "." || true)"
            echo "$TC_OUT" | grep -iE 'error[s]?\b' | head -8 | sed 's/^/  [py-type] /' >&2
        fi
    fi
    IFS=','
done
IFS="$oldifs"

exit 0
