#!/usr/bin/env bash
# postcompact-restore.sh — PostCompact hook
#
# After Claude Code compresses the conversation, re-inject the work handoff
# doc precompact-archive.sh wrote (branch, OpenSpec task progress, recent
# commits) via additionalContext, so the continuing conversation regains its
# bearings without re-deriving them. session-start.sh surfaces the same
# handoff on the next session (manual /new path) as a backstop.
#
# This hook used to also restore missing Review Sentinel `.pending-*` files
# from a precompact JSON checkpoint. Sentinel was retired (#376/#377); that
# checkpoint and its restore path are gone with it.
#
# Trigger: PostCompact event (wired once in hooks/hooks.json).
# Cost: 1 file read, <10ms.

set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh"
. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/json-out.sh"

ROOT="$(dhpk_root)"
CKPT_DIR="$ROOT/.claude/artifacts/checkpoints"
PROFILE="$(dhpk_config_profile)"

HANDOFF="$CKPT_DIR/handoff-latest.md"
ctx=""
if [ -f "$HANDOFF" ]; then
    handoff_body="$(sed -n '1,60p' "$HANDOFF" 2>/dev/null || true)"
    if [ -n "$handoff_body" ]; then
        ctx="[postcompact-restore] work handoff (auto-saved at PreCompact):
$handoff_body"
    fi
fi

if [ -n "$ctx" ] && [ "$PROFILE" != "minimal" ]; then
    emit_additional_context "PostCompact" "$ctx"
fi

exit 0
