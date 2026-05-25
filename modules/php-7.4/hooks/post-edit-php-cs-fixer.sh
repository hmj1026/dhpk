#!/usr/bin/env bash
# post-edit-php-cs-fixer.sh — PHP module PostToolUse (Edit/Write/MultiEdit) hook.
#
# Goal: surface php-cs-fixer findings right after a `.php` edit instead of
# waiting for commit / CI.
#
# Design:
#   - async-friendly: always exit 0; never blocks the edit pipeline.
#   - Silent skip when any prerequisite is missing (binary, config file,
#     vendor/ skip path, non-.php file). Avoid noise on every edit.
#   - 10s timeout so very large files don't stall the pipeline.
#
# Binary discovery:
#   1. CLAUDE_PLUGIN_OPTION_PHP_CS_FIXER_BIN env var (full path or `bin-name`).
#   2. vendor/bin/php-cs-fixer (composer default).
#   3. PATH lookup as a last resort.
#
# Config discovery: project must ship one of the filenames listed in
# module.yaml's php.config_files.cs_fixer (defaults
# `.php-cs-fixer.php` / `.php-cs-fixer.dist.php`). No config → no run.

set -o pipefail

. "$(dirname "$0")/../../../scripts/hooks/_lib/payload.sh"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

PAYLOAD="$(cat 2>/dev/null || true)"
[ -z "$PAYLOAD" ] && exit 0

FILE_PATH="$(extract_tool_input file_path "$PAYLOAD")"
[ -z "$FILE_PATH" ] && FILE_PATH="$(extract_tool_input filePath "$PAYLOAD")"
[ -z "$FILE_PATH" ] && exit 0

# Only act on .php files that physically exist.
case "$FILE_PATH" in *.php) ;; *) exit 0 ;; esac
[ -f "$FILE_PATH" ] || exit 0

REL="${FILE_PATH#$ROOT/}"

# Hardcoded skip: composer-managed vendor/. Never lint someone else's code.
case "$REL" in vendor/*|*/vendor/*) exit 0 ;; esac

# Find the config file. Silent skip when absent — many projects use PHP_CodeSniffer
# / no-formatter setups, and we shouldn't bark at them on every edit.
cfg=""
for candidate in .php-cs-fixer.php .php-cs-fixer.dist.php; do
    if [ -f "$ROOT/$candidate" ]; then cfg="$ROOT/$candidate"; break; fi
done
[ -n "$cfg" ] || exit 0

# Find the binary.
bin="${CLAUDE_PLUGIN_OPTION_PHP_CS_FIXER_BIN:-}"
if [ -z "$bin" ]; then
    if [ -x "$ROOT/vendor/bin/php-cs-fixer" ]; then
        bin="$ROOT/vendor/bin/php-cs-fixer"
    elif command -v php-cs-fixer >/dev/null 2>&1; then
        bin="$(command -v php-cs-fixer)"
    fi
fi
[ -n "$bin" ] && [ -x "$bin" ] || exit 0

cd "$ROOT" || exit 0
OUTPUT=""
if command -v timeout >/dev/null 2>&1; then
    OUTPUT="$(timeout 10 "$bin" fix --dry-run --diff --using-cache=no --no-interaction --path-mode=intersection "$REL" 2>&1 || true)"
else
    OUTPUT="$("$bin" fix --dry-run --diff --using-cache=no --no-interaction --path-mode=intersection "$REL" 2>&1 || true)"
fi

# php-cs-fixer reports `Found X errors while linting` for parse errors or
# `1) <file>` followed by `--- Original` / `+++ New` for style diffs.
if echo "$OUTPUT" | grep -qE '^\s*[0-9]+\)\s'; then
    echo "[php-cs-fixer] ⚠ style issues in $REL (run 'php-cs-fixer fix $REL' to apply)" >&2
    echo "$OUTPUT" | grep -E '^\s+[+-]|^---|^\+\+\+' | head -10 | sed 's/^/  /' >&2
elif echo "$OUTPUT" | grep -qE 'Parse error|syntax error|while linting'; then
    echo "[php-cs-fixer] ⚠ parse error in $REL — fix before commit" >&2
    echo "$OUTPUT" | grep -E 'error|Error' | head -3 | sed 's/^/  /' >&2
fi

exit 0
