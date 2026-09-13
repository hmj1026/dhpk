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

# Dedup — skip POST if this observation is byte-identical to the last one posted
# under the same change_id. Long opsx-apply-resume sessions Save many times with the
# same L0 headline, which would otherwise spam claude-mem recall with near-duplicate
# rows. Fingerprint = sha256(title + NUL + content); cache keyed by concepts[0].
# Fail-open: any jq/payload issue falls through to a normal POST.
OBS_TITLE=$(jq -r '.title // ""' "$PAYLOAD_FILE" 2>/dev/null)
OBS_CONTENT=$(jq -r '.content // ""' "$PAYLOAD_FILE" 2>/dev/null)
OBS_CONCEPT=$(jq -r '.concepts[0] // "global"' "$PAYLOAD_FILE" 2>/dev/null)
OBS_FP=$(printf '%s\0%s' "$OBS_TITLE" "$OBS_CONTENT" | sha256sum 2>/dev/null | cut -d' ' -f1)
CONCEPT_KEY=$(printf '%s' "$OBS_CONCEPT" | sha256sum 2>/dev/null | cut -c1-12)
FP_FILE="${TMPDIR:-/tmp}/claude-mem-obs-fp-${CONCEPT_KEY}"

if [[ -n "$OBS_FP" && -f "$FP_FILE" ]]; then
  PREV_FP=$(sed -n '1p' "$FP_FILE" 2>/dev/null)
  if [[ "$PREV_FP" == "$OBS_FP" ]]; then
    PREV_ID=$(sed -n '2p' "$FP_FILE" 2>/dev/null)
    echo "[post-obs] dedup: identical to last observation for ${OBS_CONCEPT}, skipped" >&2
    echo "${PREV_ID:-null}"
    exit 0
  fi
fi

RESULT_FILE=$(mktemp /tmp/claude-mem-obs-result-XXXXXX.json)
trap 'rm -f "$RESULT_FILE"' EXIT

curl -s -m 5 -X POST "http://127.0.0.1:${PORT}/api/observations" \
  -H "Content-Type: application/json" \
  -d "@${PAYLOAD_FILE}" \
  -o "$RESULT_FILE" 2>/dev/null

OBS_ID=$(jq -r '.id // empty' "$RESULT_FILE" 2>/dev/null)
rm -f "$RESULT_FILE"

# Record fingerprint for next-call dedup (best-effort; ignore write failures)
if [[ -n "$OBS_FP" ]]; then
  printf '%s\n%s\n' "$OBS_FP" "${OBS_ID:-null}" > "$FP_FILE" 2>/dev/null || true
fi

echo "${OBS_ID:-null}"
