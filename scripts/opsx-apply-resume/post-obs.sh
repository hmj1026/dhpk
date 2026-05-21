#!/usr/bin/env bash
# post-obs.sh — POST a claude-mem observation using a temp file (safe for special chars)
#
# Usage: bash .claude/scripts/opsx-apply-resume/post-obs.sh <payload_json_file>
# Outputs: obs_id (integer string) or "null"
#
# The caller (model) writes the JSON payload to a temp file first,
# then calls this script. Using -d @file avoids shell injection from
# newlines / quotes / metacharacters in handover_context.

PAYLOAD_FILE="$1"
PORT="${CLAUDE_MEM_WORKER_PORT:-37777}"

if [[ -z "$PAYLOAD_FILE" ]]; then
  echo "ERROR: payload file argument required. Usage: post-obs.sh <payload_json_file>"
  exit 1
fi

if [[ ! -f "$PAYLOAD_FILE" ]]; then
  echo "ERROR: payload file not found: $PAYLOAD_FILE"
  exit 1
fi

# Health check — if worker not reachable, return null immediately
HEALTH=$(curl -s -m 2 "http://127.0.0.1:${PORT}/health" 2>/dev/null)
if [[ -z "$HEALTH" ]]; then
  echo "null"
  exit 0
fi

RESULT_FILE=$(mktemp /tmp/claude-mem-obs-result-XXXXXX.json)
trap 'rm -f "$RESULT_FILE"' EXIT

curl -s -m 5 -X POST "http://127.0.0.1:${PORT}/api/observations" \
  -H "Content-Type: application/json" \
  -d "@${PAYLOAD_FILE}" \
  -o "$RESULT_FILE" 2>/dev/null

OBS_ID=$(jq -r '.id // empty' "$RESULT_FILE" 2>/dev/null)
rm -f "$RESULT_FILE"

echo "${OBS_ID:-null}"
