#!/usr/bin/env bash
# python-env.sh — shared helpers for dhpk python module hooks.
# Source-only — never execute directly. No side effects on sourcing.
# bash 3.2 compatible (no associative arrays, no mapfile, no `${var,,}`).
#
# Config is read from userConfig knobs that Claude Code exports as
# CLAUDE_PLUGIN_OPTION_<KEY> (see modules/python/module.yaml for the contract):
#   PYTHON_PROJECT_ROOTS  CSV of subdirs to restrict linting to (default: unset = walk-up)
#   PYTHON_RUNNER         tool runner prefix (default: "uv run"; "" = bare PATH)
#   RUFF_BIN              ruff executable (default: "ruff")
#   PYTHON_TYPECHECKER    pyright | mypy | none (default: pyright)
#   PYRIGHT_BIN           pyright executable (default: "pyright")
#   MYPY_BIN              mypy executable (default: "mypy")

# Version probes share the portable deadline. A missing mechanism is not a pass.
# Locate the helper from this file, not PATH, so a stripped PATH still fail-closes.
_py_env_src="${BASH_SOURCE[0]}"
_py_env_dir="${_py_env_src%/*}"
# shellcheck disable=SC1091
. "${_py_env_dir}/../../../../scripts/hooks/_lib/portable-timeout.sh"
PY_TOOL_PROBE_SECS=5

# py_project_dir <file_abs> <repo_root>
#   Walk up from dirname(file) to repo_root; echo the first dir containing a
#   pyproject.toml / setup.cfg / setup.py. When PYTHON_PROJECT_ROOTS is set the
#   resolved dir must be one of those roots (relative to repo_root) or the
#   result is empty (out-of-scope file). Echo empty when no project dir found.
py_project_dir() {
    local file="$1" repo="$2" dir
    dir="$(cd "$(dirname "$file")" 2>/dev/null && pwd)" || return 0
    repo="$(cd "$repo" 2>/dev/null && pwd)" || return 0
    while :; do
        if [ -f "$dir/pyproject.toml" ] || [ -f "$dir/setup.cfg" ] || [ -f "$dir/setup.py" ]; then
            _py_root_allowed "$dir" "$repo" && printf '%s' "$dir"
            return 0
        fi
        [ "$dir" = "$repo" ] && break
        [ "$dir" = "/" ] && break
        dir="$(dirname "$dir")"
    done
    return 0
}

# _py_root_allowed <dir_abs> <repo_abs>
#   Honour the optional PYTHON_PROJECT_ROOTS restriction list.
_py_root_allowed() {
    local dir="$1" repo="$2" roots="${CLAUDE_PLUGIN_OPTION_PYTHON_PROJECT_ROOTS:-}"
    [ -z "$roots" ] && return 0   # no restriction configured
    local rel="${dir#$repo/}"
    [ "$rel" = "$dir" ] && rel="."   # dir == repo root
    local r oldifs="$IFS"
    IFS=','
    for r in $roots; do
        r="$(printf '%s' "$r" | sed 's#^\./##; s#/*$##; s#^[[:space:]]*##; s#[[:space:]]*$##')"
        [ -z "$r" ] && r="."
        if [ "$rel" = "$r" ]; then IFS="$oldifs"; return 0; fi
    done
    IFS="$oldifs"
    return 1
}

# py_runner_words <runner>
#   Split a runner prefix into PY_RUNNER_WORDS. Empty is bare PATH (return 0).
#   The supported form is whitespace-separated words made of letters, digits,
#   and _ . / : + = -, such as "uv run" or "uv run --frozen". Quotes, globs,
#   and shell control characters are rejected with return 2 and are never
#   executed. Callers must diagnose that status; this function does not eval.
py_runner_words() {
    PY_RUNNER_WORDS=()
    local runner="$1" oldifs
    [ -z "$runner" ] && return 0
    case "$runner" in
        *[![:alnum:][:space:]_./:+=-]*) return 2 ;;
    esac
    oldifs="$IFS"
    set -f
    IFS=$' \t\n'
    # shellcheck disable=SC2086
    set -- $runner
    set +f
    IFS="$oldifs"
    [ "$#" -eq 0 ] && return 0
    PY_RUNNER_WORDS=("$@")
    return 0
}

# py_runner_prefix
#   Echo the runner prefix (e.g. "uv run") IF it is a supported word list and
#   its first token resolves on PATH. Echo nothing when the runner is empty or
#   its command is absent — the caller then runs the tool bare off PATH.
#   Return 2 when the runner contains shell syntax. Nothing is echoed, and the
#   caller must not execute that value.
py_runner_prefix() {
    local runner="${CLAUDE_PLUGIN_OPTION_PYTHON_RUNNER-uv run}"
    [ -z "$runner" ] && return 0
    py_runner_words "$runner" || return 2
    [ "${#PY_RUNNER_WORDS[@]}" -eq 0 ] && return 0
    command -v "${PY_RUNNER_WORDS[0]}" >/dev/null 2>&1 || return 0
    printf '%s' "$runner"
    return 0
}

# py_tool_ok <project_dir> <runner_prefix> <tool_bin>
#   Probe whether <tool_bin> is actually invokable (handles `uv run ruff` where
#   ruff is a project dep, and bare `ruff` on PATH). The runner prefix and the
#   tool path are argv, never a second shell parse. Returns 0 when runnable.
py_tool_ok() {
    local pdir="$1" prefix="$2" tool="$3"
    local -a cmd
    cmd=()
    if [ -n "$prefix" ]; then
        py_runner_words "$prefix" || return 1
        [ "${#PY_RUNNER_WORDS[@]}" -gt 0 ] || return 1
        command -v "${PY_RUNNER_WORDS[0]}" >/dev/null 2>&1 || return 1
        cmd+=("${PY_RUNNER_WORDS[@]}")
    else
        command -v "$tool" >/dev/null 2>&1 || return 1
    fi
    cmd+=("$tool" "--version")
    local rc=0
    (
        cd "$pdir" 2>/dev/null || exit 1
        run_with_timeout "$PY_TOOL_PROBE_SECS" "${cmd[@]}"
    ) >/dev/null 2>&1
    rc=$?
    # 124/125 stay distinct so callers can fail closed instead of skipping.
    case "$rc" in
        0|124|125) return "$rc" ;;
        *) return 1 ;;
    esac
}
