#!/usr/bin/env bash
# stop-failure-log.sh — StopFailure hook (advisory only)
#
# Logs active sentinels when a session terminates abnormally, so the next
# SessionStart (or a human) can see "which review steps were still pending
# when the previous session crashed."
#
# Design:
# - Lists every `.claude/artifacts/sessions/.pending-*` sentinel currently
#   present (uses SENTINEL_NAMES SSOT — no missed/spurious entries).
# - Appends one line to `.claude/artifacts/stop-failures.log` (CSV-like,
#   easy to grep / parse).
# - Also prints one stderr summary so the user sees the state immediately in
#   the terminal — StopFailure is more serious than SubagentStop, so a
#   visible signal is justified.
# - Always exits 0 — advisory only; never adds new stop blocks.
# - Profile-aware: minimal profile suppresses stderr but still writes log.
#
# Trigger: StopFailure event (wired once in hooks/hooks.json).
# Cost: file stat only, <20ms.

set -o pipefail

. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SESS="$ROOT/.claude/artifacts/sessions"
LOG="$ROOT/.claude/artifacts/stop-failures.log"
PROFILE="${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-standard}"
TIMESTAMP="$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"

# Collect currently active sentinels (SENTINEL_NAMES SSOT — keeps in sync
# with the rest of the chain automatically).
active=()
for name in "${SENTINEL_NAMES[@]}"; do
    [ -f "$SESS/$name" ] && active+=("$name")
done

# Format CSV. Empty list prints "none" (not "") so it remains grep-friendly.
if [ "${#active[@]}" -eq 0 ]; then
    csv="none"
else
    csv="$(IFS=,; printf '%s' "${active[*]}")"
fi

# Try to capture supplemental fields from stdin payload.
PAYLOAD="$(cat 2>/dev/null || true)"
extra=""
if [ -n "$PAYLOAD" ]; then
    if command -v jq >/dev/null 2>&1; then
        extra="$(printf '%s' "$PAYLOAD" | jq -r '
            (.reason // .message // .hook_event_name // "") | tostring
        ' 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]*$//' || true)"
    elif command -v python3 >/dev/null 2>&1; then
        extra="$(printf '%s' "$PAYLOAD" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get("reason") or d.get("message") or d.get("hook_event_name") or "")
except Exception:
    pass
' 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]*$//' || true)"
    fi
fi

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

# Format: timestamp active_sentinels=<csv> [reason=<text>]
if [ -n "$extra" ]; then
    echo "$TIMESTAMP active_sentinels=$csv reason=$extra" >> "$LOG" || true
else
    echo "$TIMESTAMP active_sentinels=$csv" >> "$LOG" || true
fi

# Visible summary (skipped in minimal profile).
if [ "$PROFILE" != "minimal" ]; then
    echo >&2 "[stop-failure-log] session abnormal stop — active_sentinels=$csv (logged to .claude/artifacts/stop-failures.log)"
fi

exit 0
