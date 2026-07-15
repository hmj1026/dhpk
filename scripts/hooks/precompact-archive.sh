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
# Checkpoint schema: "dhpk.checkpoint.v1" — { schema, session_id, ts, sentinels:
#   { "<name>": "<content>" } }. postcompact-restore.sh reads ONLY this version
#   (no migration path), so any breaking change to the shape must bump the
#   version string in BOTH files together, or restore silently no-ops.
#
# Trigger: PreCompact event (wired once in hooks/hooks.json).
# Cost: O(active sentinels) reads + 1 file write, <50ms.
#
# Checkpoint retention: this hook never deletes old checkpoints. reap-stale-
# sentinels.sh (Stop hook) handles cleanup of files older than 7 days.

set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh"
. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"

ROOT="$(dhpk_root)"
SESS="$(dhpk_sessions_dir "$ROOT")"
CKPT_DIR="$ROOT/.claude/artifacts/checkpoints"
PROFILE="${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-standard}"

mkdir -p "$CKPT_DIR" 2>/dev/null || true

PAYLOAD="$(dhpk_read_payload)"

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

# ── Work-state handoff doc ───────────────────────────────────────────────────
# Beyond the sentinel JSON, write a readable handoff capturing the deterministic
# work state a shell hook CAN observe (git, sentinels, OpenSpec change + task
# progress, recent commits). postcompact-restore.sh / session-start surface this
# so the conversation continues post-compact without losing the thread. The
# semantic layer (what we're doing / why) lives in claude-mem. Pure shell + git,
# so it works even without python3. Best-effort; never blocks compaction.
HANDOFF="$CKPT_DIR/handoff-latest.md"
{
    printf '# Work Handoff — %s\n\n' "$TS"
    printf '> Auto-written at PreCompact. Deterministic disk/git state only; semantic detail (what/why) lives in claude-mem.\n\n'
    printf -- '- **branch**: `%s`\n' "${BRANCH:-?}"

    _pending=""
    for _n in "${SENTINEL_NAMES[@]}"; do
        [ -f "$SESS/$_n" ] && _pending="$_pending $_n"
    done
    printf -- '- **pending reviews**:%s\n' "${_pending:- none}"

    _osc_dir="$ROOT/openspec/changes"
    if [ -d "$_osc_dir" ]; then
        # Newest change dir (by mtime) that is an ACTIVE change — exclude the
        # archive/ subdir and require a tasks.md.
        # `ls -1dt .../*/` emits trailing-slash dirs newest-first; both the
        # archive guard (`*/archive/`) and the `${_d}tasks.md` join rely on that
        # trailing slash (and degrade safely if a future ls strips it).
        _change=""
        while IFS= read -r _d; do
            case "$_d" in */archive/) continue ;; esac
            [ -f "${_d}tasks.md" ] || continue
            _change="$_d"; break
        done < <(ls -1dt "$_osc_dir"/*/ 2>/dev/null)
        if [ -n "$_change" ]; then
            printf -- '- **OpenSpec change**: `%s`\n' "$(basename "$_change")"
            # grep -c already prints "0" on zero matches (exit 1) — use `|| true`,
            # not `|| echo 0`, which would append a second "0" → "0\n0".
            _done="$(grep -c '^- \[x\]' "${_change}tasks.md" 2>/dev/null || true)"
            _todo="$(grep -c '^- \[ \]' "${_change}tasks.md" 2>/dev/null || true)"
            printf -- '  - tasks: %s done / %s open\n' "${_done:-0}" "${_todo:-0}"
        fi
    fi

    printf '\n## Working tree\n\n```\n'
    git -C "$ROOT" status --short 2>/dev/null | head -40
    printf '```\n\n## Recent commits\n\n```\n'
    git -C "$ROOT" log --oneline -8 2>/dev/null
    printf '```\n'
} > "$HANDOFF" 2>/dev/null || true

if [ "$PROFILE" != "minimal" ]; then
    echo >&2 "[precompact-archive] saved checkpoint (sentinels=$restored_count) → $CKPT"
    [ -f "$HANDOFF" ] && echo >&2 "[precompact-archive] wrote work handoff → $HANDOFF"
fi

exit 0
