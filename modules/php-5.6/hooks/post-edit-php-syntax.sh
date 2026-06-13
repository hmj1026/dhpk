#!/usr/bin/env bash
# post-edit-php-syntax.sh — php-5.6 module PostToolUse (Edit|Write|MultiEdit) hook.
#
# Surface PHP parse errors at edit time instead of at commit / PHPUnit time.
# Dispatched (backgrounded) by scripts/hooks/post-edit-dispatch.sh.
#
# Design:
#   - never blocks: always exit 0, findings go to stderr
#   - silent skip when php is unavailable / file missing / not *.php
#   - host php is enough to catch generic parse errors; 5.6-vs-7+ syntax drift
#     is the code-reviewer's + PHPUnit's job, this hook only stops typo-grade
#     syntax errors from landing
#   - 5s timeout so huge view files can't stall the pipeline
#
# Project override — userConfig.php_bin: the PHP binary (or wrapper command)
# to run, e.g. "docker exec -i my_php php". Default "php".

set -o pipefail

. "$(dirname "$0")/../../../scripts/hooks/_lib/payload.sh"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
. "$(dirname "$0")/../../../scripts/hooks/_lib/load-project-config.sh" 2>/dev/null || true

PHP_BIN="${CLAUDE_PLUGIN_OPTION_PHP_BIN:-php}"

PAYLOAD="$(cat 2>/dev/null || true)"
[ -z "$PAYLOAD" ] && exit 0

FILE_PATH="$(extract_tool_input file_path "$PAYLOAD")"
[ -z "$FILE_PATH" ] && FILE_PATH="$(extract_tool_input filePath "$PAYLOAD")"
[ -z "$FILE_PATH" ] && exit 0

REL="${FILE_PATH#$ROOT/}"
BASENAME="${REL##*/}"

case "$BASENAME" in
    *.php) ;;
    *) exit 0 ;;
esac

# Skip review artifacts (avoid loops on generated reports).
case "$REL" in
    .claude/artifacts/*) exit 0 ;;
esac

[ -f "$FILE_PATH" ] || exit 0

# Silent skip when the (first word of the) PHP binary is not available.
_php_word="${PHP_BIN%% *}"
command -v "$_php_word" >/dev/null 2>&1 || exit 0

# Run php -l (5s timeout where coreutils timeout exists). The exit code is
# authoritative: 0 = clean, non-zero = parse error. Don't grep for "No syntax
# errors detected" — deprecation notices on host PHP would break the match.
# $PHP_BIN is intentionally unquoted: it may be a multi-word wrapper command.
if command -v timeout >/dev/null 2>&1; then
    OUTPUT="$(timeout 5 $PHP_BIN -l "$FILE_PATH" 2>&1)"
    RC=$?
else
    OUTPUT="$($PHP_BIN -l "$FILE_PATH" 2>&1)"
    RC=$?
fi

# RC=0 → clean; RC=124 → timeout (not a parse error, stay silent).
[ "$RC" -eq 0 ] && exit 0
[ "$RC" -eq 124 ] && exit 0

FIRST_LINE="$(echo "$OUTPUT" | grep -E 'Parse error|syntax error|Fatal error' | head -1)"
[ -z "$FIRST_LINE" ] && FIRST_LINE="(php -l exit=$RC; output had no standard error string)"
echo "[php-syntax] parse error in $REL" >&2
echo "  $FIRST_LINE" >&2
echo "  (fix before commit; this hook is async advisory and does not block the edit)" >&2

exit 0
