#!/usr/bin/env bash
# check-cross-cli-drift.sh — detect when .claude/ is newer than .codex/ /
# .gemini/ sibling harness directories.
#
# Use case: projects maintaining parallel harnesses for multiple AI CLIs sync
# them manually (e.g. /multi-ai-sync). When .claude/skills, .claude/commands
# etc. change and the mirrors don't follow, the other CLI sees stale content.
# This script compares newest-file mtimes at SessionStart and prints an
# advisory when drift exceeds the threshold.
#
# Self-skipping: exits silently when neither .codex/ nor .gemini/ exists —
# zero cost for single-CLI projects.
#
# Threshold: DHPK_CROSS_CLI_DRIFT_THRESHOLD seconds (default 3600). The 1h
# default avoids "just synced, immediately nagged" noise.
# Profile filtering is the caller's job (session-start.sh skips on minimal);
# this script stays profile-free so it can be run standalone as a dry-run.
#
# Exit code: always 0 (advisory only).

set -o pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
CLAUDE_DIR="$ROOT/.claude"
DRIFT_THRESHOLD="${DHPK_CROSS_CLI_DRIFT_THRESHOLD:-3600}"

[ -d "$CLAUDE_DIR" ] || exit 0
# Early skip: no sibling CLI harness → nothing to compare.
[ -d "$ROOT/.codex" ] || [ -d "$ROOT/.gemini" ] || exit 0

# Newest mtime (epoch seconds) of any harness file under dir's
# skills/commands/agents/hooks/rules subdirs. GNU find has -printf '%T@';
# BSD find (macOS) does not — use stat -f '%m' there.
newest_mtime() {
    local dir="$1"
    [ -d "$dir" ] || { echo 0; return; }
    local subdirs=()
    for sub in skills commands agents hooks rules; do
        [ -d "$dir/$sub" ] && subdirs+=("$dir/$sub")
    done
    [ ${#subdirs[@]} -eq 0 ] && { echo 0; return; }
    if [ "$(uname)" = "Darwin" ]; then
        find "${subdirs[@]}" \
            -type f \
            \( -name '*.md' -o -name '*.sh' -o -name '*.py' -o -name '*.json' -o -name '*.toml' -o -name '*.js' \) \
            -exec stat -f '%m' {} + 2>/dev/null \
            | sort -nr | head -1
    else
        find "${subdirs[@]}" \
            -type f \
            \( -name '*.md' -o -name '*.sh' -o -name '*.py' -o -name '*.json' -o -name '*.toml' -o -name '*.js' \) \
            -printf '%T@\n' 2>/dev/null \
            | sort -nr | head -1 | awk '{print int($1)}'
    fi
}

claude_t="$(newest_mtime "$CLAUDE_DIR")"
[ -z "$claude_t" ] || [ "$claude_t" = "0" ] && exit 0

drift_targets=()
for target_name in codex gemini; do
    target_dir="$ROOT/.$target_name"
    [ -d "$target_dir" ] || continue
    target_t="$(newest_mtime "$target_dir")"
    { [ -z "$target_t" ] || [ "$target_t" = "0" ]; } && continue
    delta=$((claude_t - target_t))
    if [ "$delta" -gt "$DRIFT_THRESHOLD" ]; then
        hours=$((delta / 3600))
        if [ "$hours" -lt 1 ]; then
            mins=$((delta / 60))
            drift_targets+=(".$target_name(+${mins}m)")
        elif [ "$hours" -lt 48 ]; then
            drift_targets+=(".$target_name(+${hours}h)")
        else
            days=$((hours / 24))
            drift_targets+=(".$target_name(+${days}d)")
        fi
    fi
done

if [ ${#drift_targets[@]} -gt 0 ]; then
    echo "[session-start] cross-cli drift: .claude/ newer than ${drift_targets[*]} — consider \`/multi-ai-sync\`"
fi

exit 0
