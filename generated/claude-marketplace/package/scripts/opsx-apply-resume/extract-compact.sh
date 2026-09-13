#!/usr/bin/env bash
# extract-compact.sh — extract key fields from a compact-*.json file
#
# Usage: bash .claude/scripts/opsx-apply-resume/extract-compact.sh <compact_json_path>
# Outputs fixed human-readable lines for model consumption (no raw JSON in context)
#
# Fields output:
#   L0: <one-liner>
#   session_goal: <goal>
#   completed:
#     - <item>
#   in_progress:
#     - <item>
#   key_decisions:
#     [<decision>] <reason>
#   failed_approaches:
#     lesson: <lesson>

FILE="$1"

if [[ -z "$FILE" ]]; then
  echo "ERROR: no path provided. Usage: extract-compact.sh <compact_json_path>"
  exit 1
fi

if [[ ! -f "$FILE" ]]; then
  echo "ERROR: file not found: $FILE"
  exit 1
fi

jq -r '
  "L0: " + (.L0 // "(未取得)"),
  "session_goal: " + (.session_goal // "(未取得)"),
  "completed:",
  (if (.completed | length) > 0 then
    (.completed[]? | "  - " + (if type == "string" then . else (.task // .description // tostring) end))
  else "  (none)" end),
  "in_progress:",
  (if (.in_progress | length) > 0 then
    (.in_progress[]? | "  - " + (if type == "string" then . else (.task // .description // tostring) end))
  else "  (none)" end),
  "key_decisions:",
  (if (.key_decisions | length) > 0 then
    (.key_decisions[]? | if type == "string" then "  [" + . + "]"
      else "  [" + (.decision // .summary // "(無標題)") + "] " + (.reason // "") end)
  else "  (none)" end),
  "failed_approaches:",
  (if (.failed_approaches | length) > 0 then
    (.failed_approaches[]? | if type == "string" then "  lesson: " + .
      else "  lesson: " + (.lesson // .description // tostring) end)
  else "  (none)" end)
' "$FILE"
