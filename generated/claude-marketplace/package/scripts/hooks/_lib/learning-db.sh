#!/usr/bin/env bash
# learning-db.sh — append-only cross-session learning log + confidence view.
# Source-only — never execute directly. No side effects on sourcing.
#
# Why this exists
# ---------------
# dhpk hooks observe signals worth remembering across sessions: a reviewer
# passed, a subagent failed, a session stopped with pending sentinels. Without
# persistence each session starts blind. This lib gives the hooks a tiny,
# dependency-light store so SessionStart can surface "what we've learned" and
# Phase 2.2's graduation flow can promote stable patterns into real rules.
#
# Design (deliberately lightweight — no SQLite, no Python hard-dependency):
# - Storage: append-only JSON Lines at .claude/artifacts/learning.jsonl.
#   One event per line: {ts, epoch, kind, sig, detail, weight}.
# - Confidence is NOT stored; it is derived at read time by aggregating events
#   per `sig` (signature). This keeps writes O(1) and lock-free (append only).
# - Confidence model (matches the Phase 2 plan):
#     confidence(sig) = clamp(0,1, 0.5 + Σweight − 0.05·floor(days_since/30))
#   success events default weight +0.05, failure −0.1, anything else 0.
#   The −0.05 per 30 idle days is recency decay (stale patterns sink).
# - Opt-in: every function is a no-op unless the learning DB is enabled via
#   userConfig.learning_db_enabled=true (CLAUDE_PLUGIN_OPTION_LEARNING_DB_ENABLED)
#   or DHPK_LEARNING_DB=1 for a one-shot. Default OFF → zero behaviour change
#   for existing projects until a project deliberately turns it on.
# - jq is the primary engine. python3 is only a write-path fallback. When
#   neither is present, every function degrades to a silent no-op.
# - Size cap: when the log exceeds DHPK_LEARNING_CAP_BYTES (default 50MB) it is
#   rotated into .claude/artifacts/learning-archive/ so it can never grow
#   unbounded.

# --- enablement ------------------------------------------------------------
. "${BASH_SOURCE[0]%/*}/runtime-config.sh"

# ldb_enabled — return 0 (true) when the learning DB should record / be read.
# DHPK_LEARNING_DB env wins (1=force on, 0=force off) for one-shot toggles.
ldb_enabled() {
    [ "$(dhpk_config_bool learning_db_enabled false DHPK_LEARNING_DB)" = "true" ]
}

# ldb_path — echo the absolute path to the learning log for the active project.
# Root resolution delegates to the sibling session-env.sh (canonical order).
. "${BASH_SOURCE[0]%/*}/session-env.sh"
ldb_path() {
    printf '%s/.claude/artifacts/learning.jsonl' "$(dhpk_root)"
}

# ldb_rotate_if_needed <file> — archive the log when it grows past the cap.
ldb_rotate_if_needed() {
    local f="$1" cap="${DHPK_LEARNING_CAP_BYTES:-52428800}" size arch
    [ -f "$f" ] || return 0
    size="$(wc -c < "$f" 2>/dev/null || echo 0)"
    [ "$size" -gt "$cap" ] 2>/dev/null || return 0
    arch="$(dirname "$f")/learning-archive"
    mkdir -p "$arch" 2>/dev/null || true
    mv "$f" "$arch/learning-$(date +%Y%m%dT%H%M%S 2>/dev/null || echo rotated).jsonl" 2>/dev/null || true
    return 0
}

# ldb_record <kind> <sig> [detail] [weight] — append one event.
#   kind   : success | failure | <other> (free label)
#   sig    : stable signature grouping related events (e.g. "review:code-reviewer")
#   detail : optional freeform context (short)
#   weight : optional numeric override; defaults by kind (success +0.05 / failure -0.1)
# Always returns 0. No-op when the DB is disabled or no JSON engine is present.
ldb_record() {
    ldb_enabled || return 0
    local kind="$1" sig="$2" detail="${3:-}" weight="${4:-}"
    [ -z "$kind" ] && return 0
    [ -z "$sig" ] && return 0
    if [ -z "$weight" ]; then
        case "$kind" in
            success) weight="0.05" ;;
            failure) weight="-0.1" ;;
            *)       weight="0" ;;
        esac
    fi
    local file ts epoch
    file="$(ldb_path)"
    mkdir -p "$(dirname "$file")" 2>/dev/null || true
    ts="$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"
    epoch="$(date +%s 2>/dev/null || echo 0)"
    if command -v jq >/dev/null 2>&1; then
        jq -cn --arg ts "$ts" --argjson epoch "$epoch" --arg kind "$kind" \
           --arg sig "$sig" --arg detail "$detail" --argjson weight "$weight" \
           '{ts:$ts,epoch:$epoch,kind:$kind,sig:$sig,detail:$detail,weight:$weight}' \
           >> "$file" 2>/dev/null || true
    elif command -v python3 >/dev/null 2>&1; then
        TS="$ts" EPOCH="$epoch" KIND="$kind" SIG="$sig" DETAIL="$detail" WEIGHT="$weight" \
        python3 -c '
import os, json
rec = {
    "ts": os.environ["TS"],
    "epoch": int(os.environ.get("EPOCH") or 0),
    "kind": os.environ["KIND"],
    "sig": os.environ["SIG"],
    "detail": os.environ["DETAIL"],
    "weight": float(os.environ.get("WEIGHT") or 0),
}
print(json.dumps(rec, ensure_ascii=False))
' >> "$file" 2>/dev/null || true
    else
        return 0
    fi
    ldb_rotate_if_needed "$file"
    return 0
}

# ldb_aggregate — emit one TSV row per signature, highest confidence first.
#   columns: conf_pct<TAB>obs<TAB>days_idle<TAB>kind<TAB>sig
# Reads tolerantly (malformed lines are skipped). No-op without jq / log file.
ldb_aggregate() {
    local file
    file="$(ldb_path)"
    [ -f "$file" ] || return 0
    command -v jq >/dev/null 2>&1 || return 0
    jq -nRr '
        [ inputs | fromjson? | select(type == "object") ]
        | (now | floor) as $now
        | group_by(.sig)
        | map({
            sig: (.[0].sig // ""),
            kind: (.[0].kind // ""),
            obs: length,
            last_epoch: (map(.epoch // 0) | max),
            wsum: (map(.weight // 0) | add)
          })
        | map(.days = (($now - .last_epoch) / 86400 | floor))
        | map(.conf = (
            (0.5 + .wsum - (0.05 * ((.days / 30) | floor)))
            | if . > 1 then 1 elif . < 0 then 0 else . end))
        | sort_by(-.conf, -.obs)
        | .[]
        | [ (.conf * 100 | floor | tostring), (.obs | tostring), (.days | tostring), .kind, .sig ]
        | @tsv
    ' "$file" 2>/dev/null || true
}

# ldb_top [n] [min_obs] — top-n aggregated signatures with at least min_obs
# observations (default n=5, min_obs=2 to suppress one-off noise).
ldb_top() {
    local n="${1:-5}" min_obs="${2:-2}"
    ldb_aggregate | awk -F'\t' -v n="$n" -v m="$min_obs" '
        ($2 + 0) >= m { print; c++; if (c >= n) exit }
    '
}

# ldb_graduation_candidates [min_conf_pct] [min_obs] — signatures stable enough
# to propose for promotion to a rule/skill (Phase 2.2 consumes this).
# Defaults match the plan: confidence ≥ 0.9 AND obs ≥ 10.
ldb_graduation_candidates() {
    local min_conf="${1:-90}" min_obs="${2:-10}"
    ldb_aggregate | awk -F'\t' -v c="$min_conf" -v m="$min_obs" '
        ($1 + 0) >= c && ($2 + 0) >= m { print }
    '
}
