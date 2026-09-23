#!/usr/bin/env bash
# set-handoff-state.sh — atomically update the state field in latest.md frontmatter
#
# Usage: bash scripts/set-handoff-state.sh <new-state> [handoff-file]
# Valid states: saved | consuming | consumed
#
# saved     → handoff is ready for Resume Phase
# consuming → Resume Phase has started opsx:apply (in-flight)
# consumed  → session completed; file will be archived immediately after

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/portable-sed.sh
source "$SCRIPT_DIR/lib/portable-sed.sh"

if (( $# == 0 )); then
  echo "ERROR: state argument required. Usage: set-handoff-state.sh <saved|consuming|consumed> [handoff-file]"
  exit 1
fi
if (( $# > 2 )); then
  echo "ERROR: expected state and optional handoff path. Usage: set-handoff-state.sh <saved|consuming|consumed> [handoff-file]" >&2
  exit 1
fi

STATE="$1"
FILE="${2:-.claude/artifacts/apply-resume/latest.md}"

case "$STATE" in
  saved|consuming|consumed) ;;
  *)
    echo "ERROR: invalid state '$STATE'. Must be: saved | consuming | consumed"
    exit 1
    ;;
esac

if [[ -z "$FILE" || "$FILE" == -* ]]; then
  echo "ERROR: handoff path must be a non-empty path"
  exit 1
fi
case "/$FILE/" in
  */../*)
    echo "ERROR: handoff path must not contain '..' path components"
    exit 1
    ;;
esac

if [[ -L "$FILE" ]]; then
  echo "ERROR: handoff path must not be a symlink: $FILE"
  exit 1
fi

if [[ ! -e "$FILE" ]]; then
  echo "ERROR: latest.md not found at $FILE"
  exit 1
fi

if [[ ! -f "$FILE" ]]; then
  echo "ERROR: handoff path is not a regular file: $FILE"
  exit 1
fi

# Reject symlinked ancestors before the in-place writer runs. This keeps an
# explicit path from redirecting the update outside the selected worktree.
PARENT="$(dirname "$FILE")"
while [[ "$PARENT" != "." && "$PARENT" != "/" ]]; do
  if [[ -L "$PARENT" ]]; then
    echo "ERROR: handoff path has a symlinked parent: $PARENT"
    exit 1
  fi
  PARENT="$(dirname "$PARENT")"
done

if ! grep -q '^state:' "$FILE"; then
  echo "ERROR: handoff file has no state field: $FILE"
  exit 1
fi

if ! sed_inplace "s/^state:.*$/state: $STATE/" "$FILE"; then
  echo "ERROR: failed to update handoff state at $FILE"
  exit 1
fi

ACTUAL=$(grep '^state:' "$FILE" | awk '{print $2}')
if [[ "$ACTUAL" != "$STATE" ]]; then
  echo "ERROR: sed substitution failed — state is '$ACTUAL', expected '$STATE'"
  exit 1
fi

echo "state updated to: $STATE"

