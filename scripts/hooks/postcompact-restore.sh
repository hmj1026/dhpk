#!/usr/bin/env bash
# postcompact-restore.sh — PostCompact hook
#
# After Claude Code compresses the conversation, the in-memory awareness of
# active sentinels is lost. Restore them from the latest precompact-archive
# checkpoint so the reviewer dispatch state survives compaction.
#
# Design:
# - Reads `.claude/artifacts/checkpoints/latest.json` (symlink → newest
#   precompact-<sid>.json).
# - Only restores sentinels that are MISSING. If a sentinel currently exists,
#   the post-compact user/assistant may have already updated it — never
#   overwrite live state.
# - Always exits 0; restoration is best-effort.
# - Profile-aware: minimal profile suppresses the additionalContext summary.
#
# Trigger: PostCompact event (wired once in hooks/hooks.json).
# Cost: 1 JSON read + per-sentinel stat, <50ms.
#
# Checkpoint schema: reads "dhpk.checkpoint.v1" written by precompact-archive.sh.
# There is no migration path — a version bump there must land here too, else this
# restore silently no-ops on the unrecognized shape.

set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh"
. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/json-out.sh"

ROOT="$(dhpk_root)"
SESS="$(dhpk_sessions_dir "$ROOT")"
CKPT_DIR="$ROOT/.claude/artifacts/checkpoints"
CKPT="$CKPT_DIR/latest.json"
PROFILE="$(dhpk_config_profile)"

# No checkpoint → nothing to restore. Compaction may have happened without
# precompact (e.g. first session, or hook newly added mid-session).
[ -e "$CKPT" ] || exit 0

# Resolve symlink to real file.
if [ -L "$CKPT" ]; then
    target="$(readlink "$CKPT")"
    case "$target" in
        /*) CKPT="$target" ;;
        *)  CKPT="$CKPT_DIR/$target" ;;
    esac
fi
[ -f "$CKPT" ] || exit 0

mkdir -p "$SESS" 2>/dev/null || true

restored=()
skipped_existing=()

# python3 path: parses JSON safely (jq lacks tab/escape handling guarantees).
if command -v python3 >/dev/null 2>&1; then
    while IFS=$'\t' read -r name content_b64; do
        [ -z "$name" ] && continue
        f="$SESS/$name"
        if [ -f "$f" ]; then
            skipped_existing+=("$name")
            continue
        fi
        # Decode base64 to preserve any embedded special chars from sentinel content.
        printf '%s' "$content_b64" | base64 -d > "$f" 2>/dev/null || rm -f "$f"
        [ -f "$f" ] && restored+=("$name")
    done < <(CKPT="$CKPT" python3 <<'PY' 2>/dev/null
import json, os, base64, sys
try:
    with open(os.environ["CKPT"], "r", encoding="utf-8") as f:
        data = json.load(f)
except Exception:
    sys.exit(0)
sentinels = data.get("sentinels", {}) or {}
for name, content in sentinels.items():
    if not isinstance(name, str) or not isinstance(content, str):
        continue
    b64 = base64.b64encode(content.encode("utf-8")).decode("ascii")
    print(f"{name}\t{b64}")
PY
)
elif command -v jq >/dev/null 2>&1; then
    # jq fallback (no base64) — limited but covers the common case where
    # sentinel content has no exotic bytes. post-edit-remind only writes
    # ASCII paths separated by newlines, so this is fine in practice.
    while IFS= read -r name; do
        [ -z "$name" ] && continue
        f="$SESS/$name"
        if [ -f "$f" ]; then
            skipped_existing+=("$name")
            continue
        fi
        jq -r --arg n "$name" '.sentinels[$n] // empty' "$CKPT" > "$f" 2>/dev/null || rm -f "$f"
        [ -f "$f" ] && restored+=("$name")
    done < <(jq -r '.sentinels | keys[]' "$CKPT" 2>/dev/null || true)
fi

# ── Re-inject restore summary + work handoff via additionalContext ────────────
# Verified channel (see _lib/json-out.sh): a single JSON object with
# hookSpecificOutput.additionalContext is folded into the post-compact model
# context, so the continuing conversation regains its bearings (restored
# sentinels, branch, pending reviews, OpenSpec task progress, recent commits)
# without re-deriving them. session-start.sh surfaces the same handoff on the
# next session (manual /new path) as a backstop.
ctx=""
if [ "${#restored[@]}" -gt 0 ]; then
    ctx="[postcompact-restore] restored ${#restored[@]} sentinel(s): ${restored[*]}"
    if [ "${#skipped_existing[@]}" -gt 0 ]; then
        ctx="$ctx
[postcompact-restore] skipped (already present): ${skipped_existing[*]}"
    fi
fi

HANDOFF="$CKPT_DIR/handoff-latest.md"
if [ -f "$HANDOFF" ]; then
    handoff_body="$(sed -n '1,60p' "$HANDOFF" 2>/dev/null || true)"
    if [ -n "$handoff_body" ]; then
        [ -n "$ctx" ] && ctx="$ctx

"
        ctx="${ctx}[postcompact-restore] work handoff (auto-saved at PreCompact):
$handoff_body"
    fi
fi

if [ -n "$ctx" ] && [ "$PROFILE" != "minimal" ]; then
    emit_additional_context "PostCompact" "$ctx"
fi

exit 0
