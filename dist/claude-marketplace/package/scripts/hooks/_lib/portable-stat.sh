#!/usr/bin/env bash
# portable-stat.sh — cross-platform file mtime in epoch seconds.
# Source-only — never execute directly. No side effects on sourcing.
#
# GNU stat (Linux/WSL) uses `stat -c %Y`; BSD stat (macOS) uses `stat -f %m`.
# Centralizing the OS detect avoids the duplicated Darwin/Linux branch that
# previously lived in precompact-archive.sh, reap-stale-sentinels.sh, and
# session-start.sh.
#
# Usage:
#   . "$(dirname "$0")/_lib/portable-stat.sh"
#   mtime="$(file_mtime_epoch "$path")"   # empty string if file missing / stat fails

file_mtime_epoch() {
    local f="$1"
    [ -e "$f" ] || return 0
    if [ "$(uname)" = "Darwin" ]; then
        stat -f %m "$f" 2>/dev/null || true
    else
        stat -c %Y "$f" 2>/dev/null || true
    fi
    return 0
}
