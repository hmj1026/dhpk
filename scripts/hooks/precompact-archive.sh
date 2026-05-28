#!/usr/bin/env bash
# precompact-archive.sh — PreCompact hook
#
# Before Claude Code compresses the conversation, snapshot every active
# sentinel's content into a single JSON checkpoint so postcompact-restore.sh
# can rebuild the review-chain state if compression drops it.
#
# Design:
# - Checkpoint path: .claude/artifacts/checkpoints/precompact-<session_id>.json
# - `latest.json` symlink points to the newest checkpoint (postcompact reads it).
# - Sentinel content is JSON-encoded via python3 (preserves embedded newlines
#   and quotes from the post-edit-remind file lists).
# - Profile-aware: minimal profile still writes the checkpoint (silent) — the
#   archive is the whole point of the hook, only the stderr summary is hidden.
# - Always exits 0; failing to write a checkpoint must never block compaction.
#
# Trigger: PreCompact event (wired once in hooks/hooks.json).
# Cost: O(active sentinels) reads + 1 file write, <50ms.
#
# Checkpoint retention: this hook never deletes old checkpoints. reap-stale-
# sentinels.sh (Stop hook) handles cleanup of files older than 7 days.

set -o pipefail

. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SESS="$ROOT/.claude/artifacts/sessions"
CKPT_DIR="$ROOT/.claude/artifacts/checkpoints"
PROFILE="${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-standard}"

mkdir -p "$CKPT_DIR" 2>/dev/null || true

PAYLOAD="$(cat 2>/dev/null || true)"

# Session id extraction — multiple payload shapes across Claude Code versions.
SID=""
if [ -n "$PAYLOAD" ] && command -v jq >/dev/null 2>&1; then
    SID="$(printf '%s' "$PAYLOAD" | jq -r '.session_id // .session // empty' 2>/dev/null || true)"
fi
if [ -z "$SID" ] && [ -n "$PAYLOAD" ] && command -v python3 >/dev/null 2>&1; then
    SID="$(printf '%s' "$PAYLOAD" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get("session_id") or d.get("session") or "")
except Exception:
    pass
' 2>/dev/null || true)"
fi
# Fallback: timestamp + pid. PID alone could collide across rapid PreCompact events.
[ -z "$SID" ] && SID="$(date +%s)-$$"

CKPT="$CKPT_DIR/precompact-${SID}.json"
TS="$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"
BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null || echo '')"

# Build checkpoint via python3 (handles JSON escaping correctly — naive
# string concat would break on sentinel content with quotes or newlines).
# Falls back to a degenerate "empty sentinels" checkpoint if python3 missing.
restored_count=0
if command -v python3 >/dev/null 2>&1; then
    SID="$SID" TS="$TS" BRANCH="$BRANCH" SESS="$SESS" CKPT="$CKPT" \
    SENTINEL_NAMES_CSV="$(IFS=,; printf '%s' "${SENTINEL_NAMES[*]}")" \
    python3 <<'PY' 2>/dev/null || true
import os, json
sentinels = {}
for name in os.environ["SENTINEL_NAMES_CSV"].split(","):
    name = name.strip()
    if not name:
        continue
    p = os.path.join(os.environ["SESS"], name)
    if os.path.isfile(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                sentinels[name] = f.read()
        except OSError:
            pass
data = {
    "schema": "dhpk.checkpoint.v1",
    "timestamp": os.environ["TS"],
    "session_id": os.environ["SID"],
    "branch": os.environ["BRANCH"],
    "sentinels": sentinels,
}
with open(os.environ["CKPT"], "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
PY
    if [ -f "$CKPT" ]; then
        restored_count="$(python3 -c "import json; print(len(json.load(open('$CKPT'))['sentinels']))" 2>/dev/null || echo 0)"
    fi
else
    # No python3: write a minimal valid JSON without sentinel content.
    cat > "$CKPT" <<EOF
{
  "schema": "dhpk.checkpoint.v1",
  "timestamp": "$TS",
  "session_id": "$SID",
  "branch": "$BRANCH",
  "sentinels": {},
  "_note": "python3 unavailable — sentinel content not archived"
}
EOF
fi

# Update `latest.json` symlink so postcompact-restore can find it without
# knowing the session id. ln -sfn handles existing symlinks atomically.
ln -sfn "$(basename "$CKPT")" "$CKPT_DIR/latest.json" 2>/dev/null || true

if [ "$PROFILE" != "minimal" ]; then
    echo >&2 "[precompact-archive] saved checkpoint (sentinels=$restored_count) → $CKPT"
fi

exit 0
