#!/usr/bin/env bash
# reap-stale-sentinels.sh
#
# Inspects .pending-* sentinel files; emits a warning (stderr) when mtime
# exceeds the configured threshold. Optionally auto-clears the stale file
# when `--clear` is passed (used by pre-bash-guard's push-block path so a
# leaked sentinel can't block pushes indefinitely).
#
# Default behaviour (no args) is the original 24h warn-only used by the
# Stop hook — kept verbatim so callers without arg parsing are unaffected.
#
# Usage:
#   reap-stale-sentinels.sh                              # 24h, warn only (Stop hook)
#   reap-stale-sentinels.sh --threshold-minutes 60       # 60min, warn only
#   reap-stale-sentinels.sh --threshold-minutes 60 --clear   # 60min, auto-rm
#
# Cost: pure stat, < 50ms per invocation.

set -o pipefail

. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/portable-stat.sh"

# ---- Argument parsing (back-compatible: no args = 24h warn-only) ----
threshold_minutes=$((24 * 60))   # default 1440 min = 24h
do_clear=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --threshold-minutes)
            [ -n "${2:-}" ] || { echo "[reap-sentinels] --threshold-minutes requires a value" >&2; exit 2; }
            case "$2" in
                ''|*[!0-9]*) echo "[reap-sentinels] --threshold-minutes must be a positive integer (got: $2)" >&2; exit 2 ;;
            esac
            threshold_minutes="$2"
            shift 2
            ;;
        --clear)
            do_clear=1
            shift
            ;;
        --help|-h)
            sed -n '2,18p' "$0" >&2
            exit 0
            ;;
        *)
            echo "[reap-sentinels] unknown arg: $1" >&2
            exit 2
            ;;
    esac
done

repo_root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$repo_root" || exit 0

now="$(date +%s)"
threshold=$((threshold_minutes * 60))
found_stale=0

for name in "${SENTINEL_NAMES[@]}"; do
    sentinel="$repo_root/.claude/artifacts/sessions/$name"
    [ -f "$sentinel" ] || continue
    mtime="$(file_mtime_epoch "$sentinel")"   # _lib/portable-stat.sh (GNU/BSD)
    mtime="${mtime:-0}"
    age=$((now - mtime))
    if [ "$age" -gt "$threshold" ]; then
        # Human-readable age in the unit that matches the threshold.
        if [ "$threshold_minutes" -ge 60 ]; then
            age_disp="$((age / 3600))h"
            thresh_disp="$((threshold_minutes / 60))h"
        else
            age_disp="$((age / 60))min"
            thresh_disp="${threshold_minutes}min"
        fi
        if [ "$do_clear" -eq 1 ]; then
            rm -f "$sentinel"
            echo "[reap-sentinels] cleared STALE: $name (age ${age_disp} > threshold ${thresh_disp})" >&2
        else
            echo "[reap-sentinels] STALE: $name (age ${age_disp}, threshold ${thresh_disp})" >&2
            echo "[reap-sentinels]   Likely cause: review agent crash or interrupted session." >&2
            echo "[reap-sentinels]   To clear manually: bash $(dirname "$0")/clear-sentinel.sh \"$name\"" >&2
        fi
        found_stale=1
    fi
done

# Stop hook MUST NOT block; stale sentinels only emit stderr (or are cleared).
exit 0
