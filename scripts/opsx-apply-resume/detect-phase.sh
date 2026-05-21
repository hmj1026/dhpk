#!/usr/bin/env bash
# detect-phase.sh — determine which phase opsx-apply-resume should enter
#
# Usage: bash .claude/scripts/opsx-apply-resume/detect-phase.sh
# Outputs one token: save | resume | consuming | warn-recent
#
# save        → no latest.md, or state is corrupt/overwriting → run Save Phase
# resume      → state: saved, age >= 60s → run Resume Phase
# warn-recent → state: saved, age < 60s  → warn user (likely just saved)
# consuming   → state: consuming (opsx:apply started but did not finish)

FILE=".claude/artifacts/apply-resume/latest.md"

if [[ ! -f "$FILE" ]]; then
  echo "save"; exit 0
fi

STATE=$(grep '^state:' "$FILE" | awk '{print $2}')
SAVED_AT=$(grep '^saved_at:' "$FILE" | awk '{print $2}')
NOW=$(date +%s)
if [[ -z "$SAVED_AT" ]]; then
  FILE_TS=0
else
  FILE_TS=$(date -d "$SAVED_AT" +%s 2>/dev/null || echo 0)
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
