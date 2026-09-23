#!/usr/bin/env bash
# detect-phase.sh — determine which phase opsx-apply-resume should enter
#
# Usage: bash scripts/detect-phase.sh [handoff-file]
# Outputs one token: save | resume | consuming | warn-recent
#
# save        → no latest.md, or state is corrupt/overwriting → run Save Phase
# resume      → state: saved, age >= 60s → run Resume Phase
# warn-recent → state: saved, age < 60s  → warn user (likely just saved)
# consuming   → state: consuming (opsx:apply started but did not finish)

DEFAULT_FILE=".claude/artifacts/apply-resume/latest.md"

if (( $# > 1 )); then
  echo "ERROR: expected at most one handoff path. Usage: detect-phase.sh [handoff-file]" >&2
  exit 2
fi

FILE="${1:-$DEFAULT_FILE}"

# A handoff is a caller-selected artifact, not a shell option. Reject option
# lookalikes and traversal components before any file operation. Existing
# symlinks are rejected so an explicit path cannot make the detector inspect a
# surprising target; an absent path still means Save Phase.
if [[ -z "$FILE" || "$FILE" == -* ]]; then
  echo "ERROR: handoff path must be a non-empty path" >&2
  exit 2
fi
case "/$FILE/" in
  */../*)
    echo "ERROR: handoff path must not contain '..' path components" >&2
    exit 2
    ;;
esac

if [[ -L "$FILE" ]]; then
  echo "ERROR: handoff path must not be a symlink: $FILE" >&2
  exit 2
fi

if [[ -e "$FILE" && ! -f "$FILE" ]]; then
  echo "ERROR: handoff path is not a regular file: $FILE" >&2
  exit 2
fi

# Walk the existing parent chain without resolving it first. Resolving first
# would hide a symlinked ancestor and allow a later writer to follow it. This
# check must also run when the handoff leaf is absent: Save Phase creates that
# leaf later, so a missing leaf cannot make an unsafe ancestor acceptable.
PARENT="$(dirname "$FILE")"
while [[ "$PARENT" != "." && "$PARENT" != "/" ]]; do
  if [[ -L "$PARENT" ]]; then
    echo "ERROR: handoff path has a symlinked parent: $PARENT" >&2
    exit 2
  fi
  PARENT="$(dirname "$PARENT")"
done

if [[ ! -f "$FILE" ]]; then
  echo "save"; exit 0
fi

STATE=$(grep '^state:' "$FILE" | awk '{print $2}')
SAVED_AT=$(grep '^saved_at:' "$FILE" | awk '{print $2}')
NOW=$(date +%s)
if [[ -z "$SAVED_AT" ]]; then
  FILE_TS=0
else
  # GNU date uses -d; BSD date (macOS) needs -j -u -f with an explicit format.
  # The input ends in Z, so keep the fallback in UTC or it will be parsed as
  # local time and look hours older than it really is on non-UTC hosts.
  FILE_TS=$(date -d "$SAVED_AT" +%s 2>/dev/null \
    || date -j -u -f '%Y-%m-%dT%H:%M:%S' "${SAVED_AT%%Z*}" +%s 2>/dev/null \
    || echo 0)
fi
AGE=$(( NOW - FILE_TS ))

case "$STATE" in
  saved)
    if [[ $AGE -lt 60 ]]; then
      echo "warn-recent"
    else
      echo "resume"
    fi
    ;;
  consuming)
    echo "consuming"
    ;;
  *)
    # overwriting / corrupt / missing state field → treat as Save Phase
    echo "save"
    ;;
esac
