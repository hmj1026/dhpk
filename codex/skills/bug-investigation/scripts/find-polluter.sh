#!/usr/bin/env bash
# Find which test creates unwanted files/state by running tests one-by-one.
# Usage: ./find-polluter.sh <pollution_path> <test_glob> [test_command...]
# Example: ./find-polluter.sh '.git' 'src/**/*.test.ts'
# Example: ./find-polluter.sh 'tmp/output.json' 'tests/**/*.spec.ts' pnpm test

set -euo pipefail

usage() {
  echo "Usage: $0 <pollution_path> <test_glob> [test_command...]"
  echo "Example: $0 '.git' 'src/**/*.test.ts'"
  echo "Example: $0 'tmp/output.json' 'tests/**/*.spec.ts' pnpm test"
}

if [ $# -lt 2 ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 1
fi

POLLUTION_CHECK="$1"
TEST_PATTERN="$2"

TEST_CMD=(npm test)
if [ $# -ge 3 ]; then
  TEST_CMD=("${@:3}")
fi

echo "Searching for polluter of: $POLLUTION_CHECK"
echo "Test pattern: $TEST_PATTERN"
echo "Test command: ${TEST_CMD[*]}"
echo ""

if command -v rg >/dev/null 2>&1; then
  TEST_FILES=$(rg --files -g "$TEST_PATTERN" || true)
else
  FIND_PATTERN="$TEST_PATTERN"
  case "$FIND_PATTERN" in
    ./*) ;;
    *) FIND_PATTERN="./$FIND_PATTERN" ;;
  esac
  TEST_FILES=$(find . -path "$FIND_PATTERN" | sort || true)
fi

if [ -z "$TEST_FILES" ]; then
  echo "No test files found for pattern: $TEST_PATTERN"
  exit 1
fi

TOTAL=$(echo "$TEST_FILES" | wc -l | tr -d ' ')
COUNT=0

while IFS= read -r TEST_FILE; do
  [ -z "$TEST_FILE" ] && continue
  COUNT=$((COUNT + 1))

  if [ -e "$POLLUTION_CHECK" ]; then
    echo "Pollution already exists before test $COUNT/$TOTAL: $TEST_FILE"
    echo "Clean it up and rerun for accurate results."
    continue
  fi

  echo "[$COUNT/$TOTAL] Testing: $TEST_FILE"

  if ! "${TEST_CMD[@]}" "$TEST_FILE" >/dev/null 2>&1; then
    :
  fi

  if [ -e "$POLLUTION_CHECK" ]; then
    echo ""
    echo "FOUND POLLUTER"
    echo "Test: $TEST_FILE"
    echo "Created: $POLLUTION_CHECK"
    echo ""
    ls -la "$POLLUTION_CHECK"
    echo ""
    echo "To investigate:"
    echo "  ${TEST_CMD[*]} $TEST_FILE"
    exit 1
  fi
done <<'TESTFILES'
$TEST_FILES
TESTFILES

echo ""
echo "No polluter found - all tests clean."
exit 0
