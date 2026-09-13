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

# py_runner_prefix
#   Echo the runner prefix (e.g. "uv run") IF its first token resolves on PATH;
#   else echo nothing — the caller then runs the tool bare off PATH.
py_runner_prefix() {
    local runner="${CLAUDE_PLUGIN_OPTION_PYTHON_RUNNER-uv run}"
    [ -z "$runner" ] && return 0
    # shellcheck disable=SC2086
    set -- $runner
    command -v "$1" >/dev/null 2>&1 && printf '%s' "$runner"
    return 0
}

# py_tool_ok <project_dir> <runner_prefix> <tool_bin>
#   Probe whether <tool_bin> is actually invokable (handles `uv run ruff` where
#   ruff is a project dep, and bare `ruff` on PATH). Returns 0 when runnable.
py_tool_ok() {
    local pdir="$1" prefix="$2" tool="$3"
    if [ -n "$prefix" ]; then
        ( cd "$pdir" 2>/dev/null && eval "$prefix \"$tool\" --version" ) >/dev/null 2>&1
    else
        command -v "$tool" >/dev/null 2>&1
    fi
}
