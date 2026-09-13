#!/usr/bin/env bash
# set-handoff-state.sh — atomically update the state field in latest.md frontmatter
#
# Usage: bash .claude/scripts/opsx-apply-resume/set-handoff-state.sh <new-state>
# Valid states: saved | consuming | consumed
#
# saved     → handoff is ready for Resume Phase
# consuming → Resume Phase has started opsx:apply (in-flight)
# consumed  → session completed; file will be archived immediately after

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../hooks/_lib/portable-sed.sh
source "$SCRIPT_DIR/../hooks/_lib/portable-sed.sh"

STATE="$1"
FILE=".claude/artifacts/apply-resume/latest.md"

if [[ -z "$STATE" ]]; then
  echo "ERROR: state argument required. Usage: set-handoff-state.sh <saved|consuming|consumed>"
  exit 1
fi

case "$STATE" in
  saved|consuming|consumed) ;;
  *)
    echo "ERROR: invalid state '$STATE'. Must be: saved | consuming | consumed"
    exit 1
    ;;
esac

if [[ ! -f "$FILE" ]]; then
  echo "ERROR: latest.md not found at $FILE"
  exit 1
fi

sed_inplace "s/^state: .*/state: $STATE/" "$FILE"

ACTUAL=$(grep '^state:' "$FILE" | awk '{print $2}')
if [[ "$ACTUAL" != "$STATE" ]]; then
  echo "ERROR: sed substitution failed — state is '$ACTUAL', expected '$STATE'"
  exit 1
fi

echo "state updated to: $STATE"
