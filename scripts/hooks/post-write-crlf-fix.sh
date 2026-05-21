#!/usr/bin/env bash
# post-write-crlf-fix.sh — PostToolUse (Write|Edit|MultiEdit) hook (async-safe)
# Normalise CRLF → LF in .sh files written from WSL hosts.
# bash refuses CRLF scripts ($'\r': command not found).
# GNU sed (Linux/WSL): sed -i; BSD sed (macOS): sed -i ''.
set -o pipefail

PAYLOAD="$(cat 2>/dev/null || true)"

FILE=""
if [ -n "$PAYLOAD" ]; then
    if command -v jq >/dev/null 2>&1; then
        FILE="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)"
    fi
    if [ -z "$FILE" ] && command -v python3 >/dev/null 2>&1; then
        FILE="$(printf '%s' "$PAYLOAD" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    ti = d.get("tool_input", {})
    print(ti.get("file_path") or ti.get("path") or "")
except Exception:
    pass
' 2>/dev/null)"
    fi
fi

case "$FILE" in
    *.sh) ;;
    *) exit 0 ;;
esac

[ -f "$FILE" ] || exit 0

# Skip if no CR present.
if ! grep -q $'\r' "$FILE" 2>/dev/null; then
    exit 0
fi

if [ "$(uname)" = "Darwin" ]; then
    sed -i '' 's/\r$//' "$FILE" || { echo "[crlf-fix] WARN: sed failed for $FILE" >&2; exit 0; }
else
    sed -i 's/\r$//' "$FILE" || { echo "[crlf-fix] WARN: sed failed for $FILE" >&2; exit 0; }
fi

echo "[crlf-fix] normalised line endings: $FILE"
exit 0
