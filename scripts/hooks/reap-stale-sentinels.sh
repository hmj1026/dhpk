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

. "$(dirname "$0")/_lib/session-env.sh"
. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/portable-stat.sh"

# ---- Argument parsing (back-compatible: no args = 24h warn-only) ----
threshold_minutes=$((24 * 60))   # default 1440 min = 24h
active_threshold_minutes=60      # liveness markers are shorter-lived than pending review sentinels
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
        --active-threshold-minutes)
            [ -n "${2:-}" ] || { echo "[reap-sentinels] --active-threshold-minutes requires a value" >&2; exit 2; }
            case "$2" in
                ''|*[!0-9]*) echo "[reap-sentinels] --active-threshold-minutes must be a positive integer (got: $2)" >&2; exit 2 ;;
            esac
            active_threshold_minutes="$2"
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

repo_root="$(dhpk_root)"
cd "$repo_root" || exit 0
sessions_dir="$(dhpk_sessions_dir "$repo_root")"

now="$(date +%s)"
threshold=$((threshold_minutes * 60))
found_stale=0

for name in "${SENTINEL_NAMES[@]}"; do
    sentinel="$sessions_dir/$name"
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

# ---- Active liveness marker pass: prune stale entries individually ----
active_threshold=$((active_threshold_minutes * 60))
if [ -d "$sessions_dir" ]; then
    for name in "${SENTINEL_NAMES[@]}"; do
        active_name="$(dhpk_active_marker "$name")"
        active="$sessions_dir/$active_name"
        [ -f "$active" ] || continue
        tmp="$(mktemp 2>/dev/null || printf '%s.reap.tmp' "$active")"
        : > "$tmp"
        stale_count=0
        while IFS= read -r line || [ -n "$line" ]; do
            [ -n "$line" ] || continue
            ts="${line%% *}"
            case "$ts" in
                ''|*[!0-9]*) printf '%s\n' "$line" >> "$tmp"; continue ;;
            esac
            age=$((now - ts))
            if [ "$age" -gt "$active_threshold" ]; then
                stale_count=$((stale_count + 1))
            else
                printf '%s\n' "$line" >> "$tmp"
            fi
        done < "$active"
        if [ "$stale_count" -gt 0 ]; then
            echo "[reap-sentinels] reaped ACTIVE: $active_name ($stale_count stale entr$( [ "$stale_count" -eq 1 ] && printf 'y' || printf 'ies' ); threshold ${active_threshold_minutes}min)" >&2
            found_stale=1
        fi
        if [ -s "$tmp" ]; then
            mv -f "$tmp" "$active"
        else
            rm -f "$tmp" "$active"
        fi
    done
fi

# ---- Unknown-stray pass: .pending-* files NOT in the SSOT ----
# These have no clearing agent (clear-sentinel.sh rejects unknown names by
# whitelist), so an orphan here blocks the opsx-apply-goal `ls .pending-* == NONE`
# gate forever. Surface ALWAYS (age is irrelevant to visibility when nothing
# can ever clear it); with --clear, remove only those older than the threshold
# (a fresh one may be a legit project-custom sentinel created mid-session).
if [ -d "$sessions_dir" ]; then
    while IFS= read -r stray; do
        [ -n "$stray" ] || continue
        base="$(basename "$stray")"
        known=0
        for name in "${SENTINEL_NAMES[@]}"; do
            [ "$base" = "$name" ] && { known=1; break; }
        done
        [ "$known" -eq 1 ] && continue   # already handled by the loop above
        mtime="$(file_mtime_epoch "$stray")"
        [ -z "$mtime" ] && [ ! -e "$stray" ] && continue   # disappeared mid-scan
        mtime="${mtime:-0}"
        age=$((now - mtime))
        if [ "$threshold_minutes" -ge 60 ]; then
            age_disp="$((age / 3600))h"
            thresh_disp="$((threshold_minutes / 60))h"
        else
            age_disp="$((age / 60))min"
            thresh_disp="${threshold_minutes}min"
        fi
        if [ "$do_clear" -eq 1 ] && [ "$age" -gt "$threshold" ]; then
            rm -f "$stray"
            echo "[reap-sentinels] cleared UNKNOWN stray: $base (age ${age_disp} > threshold ${thresh_disp}; not in dhpk SSOT)" >&2
        else
            echo "[reap-sentinels] UNKNOWN sentinel: $base (age ${age_disp}) — not in dhpk SSOT; no agent will clear it." >&2
            echo "[reap-sentinels]   If project-custom, ensure its agent clears it; if orphaned, remove it:" >&2
            echo "[reap-sentinels]   rm -f \"$stray\"" >&2
        fi
        found_stale=1
    done < <(find "$sessions_dir" -maxdepth 1 -name '.pending-*' 2>/dev/null)
fi

# ---- Provenance pass (D4.4): flag sentinels whose originating OpenSpec change is
# no longer active (archived/removed) as staleness candidates. Warn-only — a
# sentinel may still list live paths, so provenance alone does not auto-clear.
prov_file="$sessions_dir/$SENTINEL_PROVENANCE_FILE"
if [ -f "$prov_file" ]; then
    while IFS=$'\t' read -r _psent _ppath _pprov; do
        [ -n "$_psent" ] || continue
        case "$_pprov" in session:*|'') continue ;; esac   # only change-slug provenance is checkable
        [ -f "$sessions_dir/$_psent" ] || continue   # sentinel must still be armed
        if [ ! -d "$repo_root/openspec/changes/$_pprov" ]; then
            echo "[reap-sentinels] PROVENANCE-STALE: $_psent lists '$_ppath' from change '$_pprov' which is no longer active (archived/removed) — candidate for staleness review." >&2
            echo "[reap-sentinels]   If this is leftover from an unrelated change, clear it: bash $(dirname "$0")/clear-sentinel.sh \"$_psent\"" >&2
            found_stale=1
        fi
    done < "$prov_file"
    # Housekeeping: prune sidecar lines whose sentinel file no longer exists.
    _tmp_prov="$(mktemp 2>/dev/null || echo "$prov_file.reap.tmp")"
    : > "$_tmp_prov"
    while IFS=$'\t' read -r _psent _ppath _pprov; do
        [ -n "$_psent" ] || continue
        [ -f "$sessions_dir/$_psent" ] && printf '%s\t%s\t%s\n' "$_psent" "$_ppath" "$_pprov" >> "$_tmp_prov"
    done < "$prov_file"
    if [ -s "$_tmp_prov" ]; then mv -f "$_tmp_prov" "$prov_file"; else rm -f "$_tmp_prov" "$prov_file"; fi
fi

# Stop hook MUST NOT block; stale sentinels only emit stderr (or are cleared).
exit 0
