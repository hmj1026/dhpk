#!/usr/bin/env bash
# reap-stale-sentinels.sh — Stop hook
# Inspects .pending-* sentinel files; mtime > 24h is treated as stale (review agent
# crash or session interrupted). By design this does NOT auto-delete: the sentinel
# may still represent legitimate pending work. It only warns + prints a clear hint.
#
# Triggered at every Claude session Stop. Additional cost is < 50ms (pure stat).

set -o pipefail

. "$(dirname "$0")/_lib/payload.sh"

repo_root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$repo_root" || exit 0

now="$(date +%s)"
threshold=$((24 * 3600))   # 24h
found_stale=0

for name in "${SENTINEL_NAMES[@]}"; do
    sentinel="$repo_root/.claude/artifacts/sessions/$name"
    [ -f "$sentinel" ] || continue
    # Portable stat: Linux GNU `stat -c %Y` vs macOS BSD `stat -f %m`.
    if [ "$(uname)" = "Darwin" ]; then
        mtime="$(stat -f %m "$sentinel" 2>/dev/null || echo 0)"
    else
        mtime="$(stat -c %Y "$sentinel" 2>/dev/null || echo 0)"
    fi
    age=$((now - mtime))
    if [ "$age" -gt "$threshold" ]; then
        hours=$((age / 3600))
        echo "[reap-sentinels] STALE: $name (age ${hours}h, threshold 24h)" >&2
        echo "[reap-sentinels]   Likely cause: review agent crash or interrupted session." >&2
        echo "[reap-sentinels]   To clear manually: bash $(dirname "$0")/clear-sentinel.sh \"$name\"" >&2
        found_stale=1
    fi
done

# Stop hook MUST NOT block; stale sentinels only emit stderr warnings.
exit 0
