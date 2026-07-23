#!/usr/bin/env bash
# _lib/sentinel-clear-core.sh — shared sentinel-file operations for the three
# sentinel entry points:
#   clear-sentinel.sh        — manual / triage clear (fail-loud front door)
#   subagent-stop-verify.sh  — sanctioned reviewer auto-clear
#   reap-stale-sentinels.sh  — stale / stray reap (GC)
#
# Two layers, so the physical removal has a single implementation while each
# entry point keeps its OWN semantics:
#
#   sentinel_remove_file   — the bare rm, no side effects. The single
#                            implementation of sentinel-file removal; all three
#                            entry points route their removal through it.
#   sentinel_clear_present — the SANCTIONED clear: remove + canonical status
#                            line + ldb review success + backoff reset. Used by
#                            clear-sentinel.sh and subagent-stop-verify.sh's
#                            fallback. Deliberately NOT used by reap: a stale
#                            reap is a garbage-collect, not a passed review, so
#                            it must not record review success or reset the
#                            review backoff (that would mask an unreviewed slot).
#
# Callers of sentinel_clear_present MUST have already sourced _lib/session-env.sh
# (dhpk_reset_review_backoff) and _lib/learning-db.sh (ldb_record). sentinel_remove_file
# has no such dependency.

# Idempotent source guard.
[ -n "${_DHPK_SENTINEL_CLEAR_CORE_LOADED:-}" ] && return 0
_DHPK_SENTINEL_CLEAR_CORE_LOADED=1

# sentinel_remove_file <sentinel_path>
# The single implementation of sentinel-file removal. Takes a FULL path (callers
# hold either a full path or a sess+name pair — full path is the common shape).
# Physical rm only — no logging, no backoff reset, no ldb record. Idempotent.
sentinel_remove_file() {
    rm -f "$1"
}

# sentinel_clear_present <sess_dir> <sentinel_name> <label>
# Sanctioned clear of ONE known, PRESENT sentinel: remove the file, emit the
# canonical cleared status line, record an ldb review success, and reset the
# review backoff. The caller must have validated the name as known and confirmed
# the file exists.
sentinel_clear_present() {
    local sess="$1" name="$2" label="$3"
    sentinel_remove_file "$sess/$name"
    echo "[$label] sentinel cleared ($name)"
    ldb_record success "review:$name" "$label"
    dhpk_reset_review_backoff "$sess" "$name"
}
