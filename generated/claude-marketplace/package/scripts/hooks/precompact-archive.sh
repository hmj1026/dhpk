#!/usr/bin/env bash
# precompact-archive.sh — PreCompact hook
#
# Before Claude Code compresses the conversation, write a readable handoff
# doc capturing the deterministic work state a shell hook CAN observe (git
# status, OpenSpec change + task progress, recent commits), so the
# conversation continues post-compact without losing the thread. The
# semantic layer (what we're doing / why) lives in claude-mem. Pure shell +
# git, so it works even without python3. Best-effort; never blocks
# compaction.
#
# This hook used to also snapshot every active Review Sentinel's `.pending-*`
# content into a JSON checkpoint for postcompact-restore.sh to rebuild if
# compression dropped it. Sentinel was retired (#376/#377); that checkpoint
# and its restore hook are gone with it.
#
# Trigger: PreCompact event (wired once in hooks/hooks.json).
# Cost: one git status + one git log, <30ms.

set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh"
. "$(dirname "$0")/_lib/load-project-config.sh"

ROOT="$(dhpk_root)"
CKPT_DIR="$ROOT/.claude/artifacts/checkpoints"
PROFILE="$(dhpk_config_profile)"

mkdir -p "$CKPT_DIR" 2>/dev/null || true

TS="$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"
BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null || echo '')"

HANDOFF="$CKPT_DIR/handoff-latest.md"
{
    printf '# Work Handoff — %s\n\n' "$TS"
    printf '> Auto-written at PreCompact. Deterministic disk/git state only; semantic detail (what/why) lives in claude-mem.\n\n'
    printf -- '- **branch**: `%s`\n' "${BRANCH:-?}"

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
    [ -f "$HANDOFF" ] && echo >&2 "[precompact-archive] wrote work handoff → $HANDOFF"
fi

exit 0
