#!/usr/bin/env bash
# transcript.sh — extract the session transcript path from a hook payload.
# Source-only — never execute directly. No side effects on sourcing.
#
# Both stop-completion-evidence.sh and stop-graduation-scan.sh previously
# hand-rolled this; centralized here. Prefers jq, falls back to python3, then
# to the CLAUDE_TRANSCRIPT_PATH env. Returns empty string on any failure
# (callers MUST handle empty).
#
# Usage:
#   . "$(dirname "$0")/_lib/transcript.sh"
#   tx="$(extract_transcript_path "$payload")"

extract_transcript_path() {
    local payload="$1" out=""
    if [ -n "$payload" ] && command -v jq >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | jq -r '.transcript_path // .transcript // empty' 2>/dev/null || true)"
    fi
    if [ -z "$out" ] && [ -n "$payload" ] && command -v python3 >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get("transcript_path") or d.get("transcript") or "")
except Exception:
    pass
' 2>/dev/null || true)"
    fi
    [ -z "$out" ] && out="${CLAUDE_TRANSCRIPT_PATH:-}"
    printf '%s' "$out"
    return 0
}
