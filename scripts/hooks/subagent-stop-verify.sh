#!/usr/bin/env bash
# subagent-stop-verify.sh — SubagentStop hook (non-blocking)
#
# Plugs reviewer dispatch gaps: when a reviewer agent stops SUCCESSFULLY AND a
# fresh matching canonical review evidence has leading delimited frontmatter,
# all required reviewer fields, and a parseable passing APPROVE or PASS verdict,
# auto-clear its sentinel on the reviewer's behalf — this is the SANCTIONED
# clearance path (reviewer agent definitions no longer instruct a self-run
# closing clear-sentinel.sh). A reviewer that stops exit 0 but produced no
# qualifying fresh review evidence this cycle leaves the sentinel ARMED (gate
# stays unmet so the orchestrator re-dispatches) and is logged as a failure — a
# no-output reviewer clearing its own gate was the 2026-07-13 defect this
# closes. When exit status is non-zero, leave the sentinel armed and log to
# .claude/artifacts/agent-failures.log for next-session SessionStart / manual
# review.
#
# Design:
# - Sources _lib/payload.sh SSOT (SENTINEL_NAMES / SENTINEL_AGENTS).
# - Reads stdin JSON; tries multiple field names because Claude Code's
#   SubagentStop envelope schema has evolved across versions.
# - Always exits 0 (non-blocking — must not block the next chain step).
# - Profile-aware: minimal profile suppresses stderr summary; failure log is
#   still appended so the trail survives.
#
# Trigger: SubagentStop event (wired once in hooks/hooks.json).
# Cost: file stat + one jq/python3 parse, <50ms.

set -o pipefail

# Project pluginConfigs override must precede payload.sh — payload.sh reads
# CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS at source-time to populate SENTINEL_AGENTS.
. "$(dirname "$0")/_lib/session-env.sh"
. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/learning-db.sh"
. "$(dirname "$0")/_lib/sentinel-clear-core.sh"
. "$(dirname "$0")/_lib/json-out.sh"
. "$(dirname "$0")/_lib/review-lifecycle.sh"

ROOT="$(dhpk_root)"
SESS="$(dhpk_sessions_dir "$ROOT")"
LOG="$ROOT/.claude/artifacts/agent-failures.log"
PROFILE="$(dhpk_config_profile)"

# Read stdin payload (JSON envelope from Claude Code SubagentStop event).
PAYLOAD="$(dhpk_read_payload)"

# Try multiple field names — SubagentStop envelope schema differs across
# Claude Code versions. The current (verified) schema delivers the reviewer
# identity in top-level `agent_type`, prefixed with the plugin namespace (e.g.
# `dhpk:doc-reviewer`); other candidates are kept for back-compat / forward-compat.
extract_subagent_name() {
    local payload="$1" out=""
    [ -z "$payload" ] && return 0
    if command -v jq >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | jq -r '
            .agent_type // .subagent_type // .subagent // .agent_name // .tool_input.subagent_type // empty
        ' 2>/dev/null || true)"
    fi
    if [ -z "$out" ] && command -v python3 >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(
        d.get("agent_type")
        or d.get("subagent_type")
        or d.get("subagent")
        or d.get("agent_name")
        or d.get("tool_input", {}).get("subagent_type")
        or ""
    )
except Exception:
    pass
' 2>/dev/null || true)"
    fi
    printf '%s' "$out"
}

# Maintenance note: if Claude Code adds new failure-status field names (e.g.
# `failed`, `error`, `outcome.status`), extend the candidate list below.
# Missing exit_status is treated as success — intentionally conservative to
# avoid false alarms.
extract_exit_status() {
    local payload="$1" out=""
    [ -z "$payload" ] && { printf '0'; return 0; }
    if command -v jq >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | jq -r '
            .exit_status // .status // .exit_code // empty
        ' 2>/dev/null || true)"
    fi
    if [ -z "$out" ] && command -v python3 >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    v = d.get("exit_status")
    if v is None:
        v = d.get("status")
    if v is None:
        v = d.get("exit_code")
    print("" if v is None else v)
except Exception:
    pass
' 2>/dev/null || true)"
    fi
    [ -z "$out" ] && out="0"
    printf '%s' "$out"
}

remove_matching_active_entry() {
    local file="$1" agent="$2" tmp=""
    [ -f "$file" ] || return 0
    tmp="$(mktemp 2>/dev/null || printf '%s.tmp.%s' "$file" "$$")"
    awk -v wanted="${agent##*:}" '
        BEGIN { removed=0 }
        {
            candidate=$2
            sub(/^.*:/, "", candidate)
            if (!removed && candidate == wanted) { removed=1; next }
            print
        }
    ' "$file" > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 0; }
    if [ -s "$tmp" ]; then
        mv -f "$tmp" "$file" 2>/dev/null || rm -f "$tmp"
    else
        rm -f "$tmp" "$file"
    fi
}

SUBAGENT="$(extract_subagent_name "$PAYLOAD")"
EXIT_STATUS="$(extract_exit_status "$PAYLOAD")"
STOP_SESSION_ID="$(extract_top_field session_id "$PAYLOAD")"
DIAG_SESSION_ID="${STOP_SESSION_ID:-unknown}"
DIAG_SESSION_ID="${DIAG_SESSION_ID//$'\t'/_}"
DIAG_SESSION_ID="${DIAG_SESSION_ID//$'\n'/_}"

case "${SUBAGENT##*:}" in
    fast-worker|codex-fast-worker|agy-fast-worker)
        remove_matching_active_entry "$SESS/$DHPK_SIDECAR_FAST_WORKER_ACTIVE" "$SUBAGENT"
        exit 0 ;;
esac

# Map subagent name → SENTINEL_AGENTS slot index → sentinel filename.
SLOT=-1
if [ -n "$SUBAGENT" ]; then
    for i in "${!SENTINEL_AGENTS[@]}"; do
        # ##*: strips the plugin namespace (dhpk:doc-reviewer -> doc-reviewer)
        # so plugin-prefixed dispatch identities match bare SENTINEL_AGENTS names.
        if [ "${SENTINEL_AGENTS[$i]##*:}" = "${SUBAGENT##*:}" ]; then
            SLOT="$i"
            break
        fi
    done
fi

# Not a reviewer agent (or schema missing subagent name) → silent exit 0.
if [ "$SLOT" -lt 0 ]; then
    exit 0
fi

SENTINEL_NAME="${SENTINEL_NAMES[$SLOT]}"
SENTINEL_FILE="$SESS/$SENTINEL_NAME"
ACTIVE_NAME="$(dhpk_active_marker "$SENTINEL_NAME")"
ACTIVE_FILE="$SESS/$ACTIVE_NAME"
TIMESTAMP="$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"
# Namespace-stripped reviewer identity (dhpk:database-reviewer -> database-reviewer)
# for the reviews-dir glob and ldb keys: review docs are named with the bare
# reviewer label (e.g. database-reviewer-*.md), so the raw prefixed $SUBAGENT
# would never match them under the real (agent_type) payload schema.
SUBAGENT_BARE="${SUBAGENT##*:}"

# Resolve the dispatch identity recorded by pre-agent-liveness-mark.sh.  The
# legacy tab sidecar remains the compatibility source; lifecycle events carry
# the scope/diff identity used by fresh-artifact consumers.
LIFECYCLE_TASK=""
LIFECYCLE_ATTEMPT="0"
LIFECYCLE_SCOPE=""
LIFECYCLE_DIFF=""
LIFECYCLE_CONTEXT="$(dhpk_lifecycle_context "$SUBAGENT_BARE" "$STOP_SESSION_ID" 2>/dev/null || true)"
if [ -n "$LIFECYCLE_CONTEXT" ]; then
    IFS=$'\t' read -r LIFECYCLE_TASK LIFECYCLE_ATTEMPT LIFECYCLE_SCOPE LIFECYCLE_DIFF _LIFECYCLE_SESSION <<< "$LIFECYCLE_CONTEXT"
fi
if [ -z "$LIFECYCLE_TASK" ]; then
    LIFECYCLE_SCOPE="$(dhpk_lifecycle_scope_id "$SENTINEL_FILE" 2>/dev/null || true)"
    LIFECYCLE_DIFF="$(dhpk_lifecycle_diff_id "$ROOT" 2>/dev/null || true)"
    LIFECYCLE_TASK="$(dhpk_lifecycle_task_id "$SENTINEL_NAME" "${STOP_SESSION_ID:-unknown}" "0" 2>/dev/null || true)"
fi
LIFECYCLE_LATEST_ARTIFACT="$(ls -t "$ROOT/.claude/artifacts/reviews/$SUBAGENT_BARE"-*.md 2>/dev/null | head -1 || true)"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

remove_one_active_entry() {
    local file="$1" tmp=""
    [ -f "$file" ] || return 0
    tmp="$(mktemp 2>/dev/null || printf '%s.tmp.%s' "$file" "$$")"
    awk 'NR > 1 { print }' "$file" > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 0; }
    if [ -s "$tmp" ]; then
        mv -f "$tmp" "$file" 2>/dev/null || rm -f "$tmp"
    else
        rm -f "$tmp" "$file"
    fi
}

# find_misplaced_review_artifact <agent> <sentinel> [session-id] — emit one
# tab-delimited diagnostic record: relative-path TAB reason. Matching
# <agent>-*.md files under .claude/artifacts/ are filtered against the latest
# dispatch-attempt baseline and optional session/attempt provenance. The
# canonical reviews/ directory is always excluded. When no candidate qualifies,
# emit TAB stale, TAB foreign, or TAB none so callers can distinguish a stale
# historical document from a genuinely absent review file without exposing paths.
#
# Why this exists: a reviewer that writes its review doc to the wrong directory
# used to produce a silent failure — the sentinel stayed armed with the message
# "wrote no fresh review doc", which is false, and the operator reached for
# clear-sentinel.sh, eroding the gate into a formality.
#
# This DIAGNOSES only. It deliberately does not feed the auto-clear: only the
# canonical reviews/ path can satisfy the existing freshness gate. A fresh
# misplaced candidate remains a failure and is labelled current-session or
# current-unknown-session; stale and explicitly foreign candidates are ignored.
review_frontmatter_field() {
    local pattern="$1" file="$2"
    awk -F: -v wanted="$pattern" '
        NR == 1 && $0 ~ /^---[[:space:]]*$/ { in_frontmatter=1; next }
        in_frontmatter && $0 ~ /^---[[:space:]]*$/ { exit }
        in_frontmatter && $0 ~ wanted {
            value=$2
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
            gsub(/^[\"\047]|[\"\047]$/, "", value)
            print value
            exit
        }
    ' "$file" 2>/dev/null || true
}

find_misplaced_review_artifact() {
    local agent="$1" sentinel="${2:-$SENTINEL_NAME}" session_id="${3:-$STOP_SESSION_ID}"
    local artifacts="$ROOT/.claude/artifacts" dispatch_file="$SESS/$DHPK_SIDECAR_REVIEW_DISPATCH"
    local record="" baseline="" expected_session="" expected_attempt="" expected_dispatch="" session_record_miss=0
    MISPLACED_SESSION=""
    MISPLACED_ATTEMPT=""
    MISPLACED_DISPATCH=""
    [ -d "$artifacts" ] || { printf '\tnone\t\t\t'; return 0; }

    # Select the latest dispatch attempt for this slot/agent. When the Stop
    # payload carries a session id, require an exact session row; otherwise fall
    # back to the newest row so legacy payloads still retain a baseline.
    if [ -f "$dispatch_file" ]; then
        if [ -n "$session_id" ]; then
            record="$(awk -F '\t' -v n="$sentinel" -v a="$agent" -v s="$session_id" \
                '$1 == n && $6 == a && $3 == s { row = $0 } END { print row }' \
                "$dispatch_file" 2>/dev/null || true)"
            if [ -z "$record" ] && [ "$session_id" != "unknown" ] && \
                awk -F '\t' -v n="$sentinel" -v a="$agent" '$1 == n && $6 == a { found = 1 } END { exit(found ? 0 : 1) }' \
                    "$dispatch_file" 2>/dev/null; then
                session_record_miss=1
            fi
        fi
        if [ -z "$session_id" ]; then
            record="$(awk -F '\t' -v n="$sentinel" -v a="$agent" \
                '$1 == n && $6 == a { row = $0 } END { print row }' \
                "$dispatch_file" 2>/dev/null || true)"
        fi
    fi
    if [ -n "$record" ]; then
        IFS=$'\t' read -r _dispatch_sentinel baseline expected_session expected_attempt expected_dispatch _dispatch_agent <<< "$record"
        [ -n "$session_id" ] || session_id="$expected_session"
    fi
    MISPLACED_SESSION="$expected_session"
    MISPLACED_ATTEMPT="$expected_attempt"
    MISPLACED_DISPATCH="$expected_dispatch"
    if [ -z "$baseline" ]; then
        baseline="$(stat -c %Y "$SESS/$sentinel" 2>/dev/null || stat -f %m "$SESS/$sentinel" 2>/dev/null || printf '0')"
    fi
    case "$baseline" in ''|*[!0-9]*) baseline=0 ;; esac

    if command -v python3 >/dev/null 2>&1; then
        ROOT_IN="$ROOT" ARTIFACTS_IN="$artifacts" AGENT_IN="$agent" BASELINE_IN="$baseline" \
        SESSION_IN="$session_id" EXPECTED_SESSION_IN="$expected_session" \
        ATTEMPT_IN="$expected_attempt" DISPATCH_IN="$expected_dispatch" \
        SESSION_RECORD_MISS_IN="$session_record_miss" \
        python3 - <<'PY' 2>/dev/null || printf '\tnone\t%s\t%s\t%s' \
            "${expected_session:-${session_id:-unknown}}" "${expected_attempt:-unknown}" "${expected_dispatch:-unknown}"
import os
from pathlib import Path

root = Path(os.environ["ROOT_IN"]).resolve()
artifacts = Path(os.environ["ARTIFACTS_IN"]).resolve()
canonical = (artifacts / "reviews").resolve()
agent = os.environ["AGENT_IN"]
baseline = float(os.environ.get("BASELINE_IN") or 0)
session = os.environ.get("SESSION_IN") or os.environ.get("EXPECTED_SESSION_IN") or ""
expected_session = os.environ.get("EXPECTED_SESSION_IN") or ""
expected_attempt = os.environ.get("ATTEMPT_IN") or ""
expected_dispatch = os.environ.get("DISPATCH_IN") or ""
session_record_miss = os.environ.get("SESSION_RECORD_MISS_IN") == "1"
session_out = expected_session or session or "unknown"
attempt_out = expected_attempt or "unknown"
dispatch_out = expected_dispatch or "unknown"

def emit(path, reason):
    print(f"{path}\t{reason}\t{session_out}\t{attempt_out}\t{dispatch_out}")
stop_session_mismatch = bool(
    session and session != "unknown" and expected_session and
    expected_session != "unknown" and session != expected_session
)

def frontmatter(path):
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    text = parts[1]
    values = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        values[key.strip().lower()] = value.strip().strip("'\"")
    return values

def first(values, *names):
    for name in names:
        value = values.get(name, "")
        if value:
            return value
    return ""

qualifying = []
stale = 0
foreign = 0
try:
    paths = list(artifacts.rglob(f"{agent}-*.md"))
except OSError:
    paths = []
for path in paths:
    try:
        if not path.is_file() or canonical == path or canonical in path.parents:
            continue
        mtime = path.stat().st_mtime
        rel = path.relative_to(root).as_posix()
    except (OSError, ValueError):
        continue
    if mtime < baseline:
        stale += 1
        continue
    if stop_session_mismatch or session_record_miss:
        foreign += 1
        continue

    meta = frontmatter(path)
    candidate_session = first(meta, "session_id", "session", "origin_session")
    candidate_attempt = first(meta, "dispatch_attempt", "attempt")
    candidate_dispatch = first(meta, "dispatch_id", "attempt_id", "dispatch")
    if candidate_session.lower() in {"unknown", "none", "null"}:
        candidate_session = ""
    is_foreign = False
    if candidate_session:
        if session and session != "unknown":
            is_foreign = candidate_session != session
        elif expected_session and expected_session != "unknown":
            is_foreign = candidate_session != expected_session
        else:
            is_foreign = True
    if not is_foreign and candidate_attempt and expected_attempt:
        is_foreign = candidate_attempt != expected_attempt
    if not is_foreign and candidate_dispatch and expected_dispatch:
        is_foreign = candidate_dispatch != expected_dispatch
    if not is_foreign and candidate_dispatch and not expected_dispatch and not candidate_session:
        is_foreign = True
    if is_foreign:
        foreign += 1
        continue

    reason = "current-session" if (candidate_session or candidate_attempt or candidate_dispatch) else "current-unknown-session"
    qualifying.append((mtime, rel, reason))

if qualifying:
    qualifying.sort(key=lambda item: (-item[0], item[1]))
    _, rel, reason = qualifying[0]
    emit(rel, reason)
elif stale or foreign:
    reasons = []
    if stale:
        reasons.append("stale")
    if foreign:
        reasons.append("foreign")
    emit("", "+".join(reasons))
else:
    emit("", "none")
PY
    else
        # Keep the same freshness, ownership, and deterministic ordering
        # contract when python3 is unavailable. Frontmatter parsing is limited
        # to simple key/value headers, but a stale or foreign file is never
        # attributed merely because it is the first find(1) result.
        local candidate="" candidate_mtime="" candidate_rel="" candidate_session="" \
            candidate_attempt="" candidate_dispatch="" candidate_foreign=0 \
            latest="" latest_mtime=-1 latest_reason="" stale_count=0 foreign_count=0
        while IFS= read -r candidate; do
            [ -n "$candidate" ] || continue
            candidate_mtime="$(stat -c %Y "$candidate" 2>/dev/null || stat -f %m "$candidate" 2>/dev/null || printf '0')"
            case "$candidate_mtime" in ''|*[!0-9]*) candidate_mtime=0 ;; esac
            if [ "$candidate_mtime" -lt "$baseline" ]; then
                stale_count=$((stale_count + 1))
                continue
            fi
            if { [ "$session_record_miss" -eq 1 ] || \
                { [ -n "$session_id" ] && [ "$session_id" != "unknown" ] && \
                [ -n "$expected_session" ] && [ "$expected_session" != "unknown" ] && \
                [ "$session_id" != "$expected_session" ]; }; }; then
                foreign_count=$((foreign_count + 1))
                continue
            fi
            candidate_session="$(review_frontmatter_field '^[[:space:]]*(session_id|session|origin_session)[[:space:]]*:' "$candidate")"
            candidate_attempt="$(review_frontmatter_field '^[[:space:]]*(dispatch_attempt|attempt)[[:space:]]*:' "$candidate")"
            candidate_dispatch="$(review_frontmatter_field '^[[:space:]]*(dispatch_id|attempt_id|dispatch)[[:space:]]*:' "$candidate")"
            case "$candidate_session" in
                [Uu][Nn][Kk][Nn][Oo][Ww][Nn]|[Nn][Oo][Nn][Ee]|[Nn][Uu][Ll][Ll]) candidate_session="" ;;
            esac
            candidate_foreign=0
            if [ -n "$candidate_session" ]; then
                if [ -n "$session_id" ] && [ "$session_id" != "unknown" ]; then
                    [ "$candidate_session" = "$session_id" ] || candidate_foreign=1
                elif [ -n "$expected_session" ] && [ "$expected_session" != "unknown" ]; then
                    [ "$candidate_session" = "$expected_session" ] || candidate_foreign=1
                else
                    candidate_foreign=1
                fi
            fi
            if [ "$candidate_foreign" -eq 0 ] && [ -n "$candidate_attempt" ] && [ -n "$expected_attempt" ] && \
                [ "$candidate_attempt" != "$expected_attempt" ]; then candidate_foreign=1; fi
            if [ "$candidate_foreign" -eq 0 ] && [ -n "$candidate_dispatch" ] && [ -n "$expected_dispatch" ] && \
                [ "$candidate_dispatch" != "$expected_dispatch" ]; then candidate_foreign=1; fi
            if [ "$candidate_foreign" -eq 0 ] && [ -n "$candidate_dispatch" ] && [ -z "$expected_dispatch" ] && \
                [ -z "$candidate_session" ]; then candidate_foreign=1; fi
            if [ "$candidate_foreign" -eq 1 ]; then
                foreign_count=$((foreign_count + 1))
                continue
            fi
            candidate_rel="${candidate#"$ROOT"/}"
            if [ "$candidate_mtime" -gt "$latest_mtime" ] || \
                { [ "$candidate_mtime" -eq "$latest_mtime" ] && [ -z "$latest" -o "$candidate_rel" < "$latest" ]; }; then
                latest="$candidate_rel"
                latest_mtime="$candidate_mtime"
                if [ -n "$candidate_session" ] || [ -n "$candidate_attempt" ] || [ -n "$candidate_dispatch" ]; then
                    latest_reason="current-session"
                else
                    latest_reason="current-unknown-session"
                fi
            fi
        done < <(find "$artifacts" -path "$artifacts/reviews" -prune -o -type f -name "$agent-*.md" -print 2>/dev/null)
        if [ -n "$latest" ]; then
            printf '%s\t%s\t%s\t%s\t%s' "$latest" "$latest_reason" \
                "${expected_session:-${session_id:-unknown}}" "${expected_attempt:-unknown}" "${expected_dispatch:-unknown}"
        elif [ "$stale_count" -gt 0 ] || [ "$foreign_count" -gt 0 ]; then
            local reasons=""
            [ "$stale_count" -gt 0 ] && reasons="stale"
            if [ "$foreign_count" -gt 0 ]; then
                [ -n "$reasons" ] && reasons="$reasons+"
                reasons="${reasons}foreign"
            fi
            printf '\t%s\t%s\t%s\t%s' "$reasons" \
                "${expected_session:-${session_id:-unknown}}" "${expected_attempt:-unknown}" "${expected_dispatch:-unknown}"
        else
            printf '\tnone\t%s\t%s\t%s' \
                "${expected_session:-${session_id:-unknown}}" "${expected_attempt:-unknown}" "${expected_dispatch:-unknown}"
        fi
    fi
}

# has_fresh_parseable_verdict <agent> <sentinel-file> — echo "1" when the latest
# review doc for <agent> exists, was produced THIS cycle (its mtime postdates
# the sentinel that armed this review), has the canonical timestamp/slug
# filename, and carries delimited frontmatter with all reviewer evidence fields
# plus a passing (`APPROVE` or `PASS`) verdict; "0" otherwise. This is the only
# sanctioned automatic sentinel-clearance decision.
# Must be called while the sentinel file still exists (before the rm below).
# Reuses the same "latest by mtime" lookup and verdict regex as
# refresh_unresolved_verdict below.
has_fresh_parseable_verdict() {
    local agent="$1" sentinel="$2" reviews_dir="$ROOT/.claude/artifacts/reviews" latest=""
    [ -d "$reviews_dir" ] || { printf '0'; return 0; }
    latest="$(ls -t "$reviews_dir/$agent"-*.md 2>/dev/null | head -1 || true)"
    [ -n "$latest" ] || { printf '0'; return 0; }
    # Freshness gate: the newest review doc must postdate the sentinel that armed
    # this cycle. `find -newer` avoids stat(1) GNU-vs-BSD portability differences.
    [ -n "$(find "$latest" -newer "$sentinel" 2>/dev/null)" ] || { printf '0'; return 0; }
    # New artifacts may carry the dispatch wave identity.  When present it is
    # mandatory; reports from another scope/diff never close this obligation.
    # Reports from pre-lifecycle versions omit these optional fields and retain
    # the existing freshness-only compatibility path.
    if dhpk_lifecycle_artifact_has_identity "$latest" 2>/dev/null && \
        ! dhpk_lifecycle_artifact_matches "$latest" "$LIFECYCLE_SCOPE" "$LIFECYCLE_DIFF" 2>/dev/null; then
        printf '0'
        return 0
    fi
    if dhpk_lifecycle_artifact_is_passing "$latest" "$agent" 2>/dev/null; then
        printf '1'
    else
        printf '0'
    fi
}

refresh_unresolved_verdict() {
    local sentinel="$1" agent="$2" reviews_dir="$ROOT/.claude/artifacts/reviews"
    local sidecar="$SESS/$DHPK_SIDECAR_UNRESOLVED_VERDICT" latest=""
    [ -d "$reviews_dir" ] || return 0
    latest="$(ls -t "$reviews_dir/$agent"-*.md 2>/dev/null | head -1 || true)"
    [ -n "$latest" ] || return 0

    mkdir -p "$SESS" 2>/dev/null || true
    SENTINEL_NAME_IN="$sentinel" AGENT_NAME_IN="$agent" ARTIFACT_IN="$latest" SIDECAR_IN="$sidecar" python3 - <<'PY' 2>/dev/null || true
import os
import re
from pathlib import Path

sentinel = os.environ["SENTINEL_NAME_IN"]
agent = os.environ["AGENT_NAME_IN"]
review_doc = Path(os.environ["ARTIFACT_IN"])
sidecar = Path(os.environ["SIDECAR_IN"])

try:
    text = review_doc.read_text(encoding="utf-8", errors="replace")
except OSError:
    raise SystemExit(0)

frontmatter = text
if text.startswith("---"):
    parts = text.split("---", 2)
    if len(parts) >= 3:
        frontmatter = parts[1]

verdict_match = re.search(r"(?im)^\s*verdict\s*:\s*['\"]?([A-Za-z_-]+)", frontmatter)
verdict = verdict_match.group(1).upper() if verdict_match else ""

def count(name):
    m = re.search(rf"(?i)\b{name}\b\s*:\s*(\d+)", frontmatter)
    return int(m.group(1)) if m else 0

critical = count("critical")
high = count("high")
medium = count("medium")
unresolved = verdict in {"BLOCK", "FAIL"} or critical > 0 or high > 0 or medium > 0

lines = []
if sidecar.exists():
    try:
        lines = [
            line for line in sidecar.read_text(encoding="utf-8", errors="replace").splitlines()
            if line and not line.startswith(sentinel + "\t")
        ]
    except OSError:
        lines = []

if unresolved:
    reason = f"{sentinel}\t{agent}\tverdict={verdict or 'UNKNOWN'} critical={critical} high={high} medium={medium} review_doc={review_doc.name}"
    lines.append(reason)

if lines:
    sidecar.write_text("\n".join(lines) + "\n", encoding="utf-8")
else:
    try:
        sidecar.unlink()
    except FileNotFoundError:
        pass
PY
}

# Liveness is independent of review success: a known reviewer has stopped, so
# exactly one in-flight entry for that slot is no longer active.
remove_one_active_entry "$ACTIVE_FILE"

if [ "$EXIT_STATUS" != "0" ]; then
    dhpk_lifecycle_emit failed-start "$LIFECYCLE_TASK" "$SUBAGENT_BARE" "$STOP_SESSION_ID" "$LIFECYCLE_ATTEMPT" "$LIFECYCLE_SCOPE" "$LIFECYCLE_DIFF" "" "" 2>/dev/null || true
    # Case A: subagent failed.
    SENTINEL_STATE="none"
    [ -f "$SENTINEL_FILE" ] && SENTINEL_STATE="$SENTINEL_NAME"
    echo "$TIMESTAMP $SUBAGENT exit=$EXIT_STATUS sentinel=$SENTINEL_STATE" >> "$LOG" || true
    ldb_record failure "agent:$SUBAGENT_BARE" "exit=$EXIT_STATUS"
    if [ "$PROFILE" != "minimal" ]; then
        msg="[subagent-verify] SUBAGENT FAILURE: $SUBAGENT (exit=$EXIT_STATUS)"
        if [ -f "$SENTINEL_FILE" ]; then
            msg="$msg
Sentinel still present: $SENTINEL_NAME — the next reviewer in the chain may not fire."
        fi
        msg="$msg
Logged to: .claude/artifacts/agent-failures.log"
        emit_system_message "$msg"
    fi
elif [ -f "$SENTINEL_FILE" ]; then
    # A fresh file becomes a producer-ready marker before any sentinel decision.
    # Parseable failures are still completed verdicts and remain unresolved;
    # only an APPROVE/PASS result satisfies the clearance gate below.
    if [ -n "$LIFECYCLE_LATEST_ARTIFACT" ] && [ -n "$(find "$LIFECYCLE_LATEST_ARTIFACT" -newer "$SENTINEL_FILE" 2>/dev/null)" ]; then
        _LIFECYCLE_IDENTITY_OK=1
        if dhpk_lifecycle_artifact_has_identity "$LIFECYCLE_LATEST_ARTIFACT" 2>/dev/null; then
            dhpk_lifecycle_artifact_matches "$LIFECYCLE_LATEST_ARTIFACT" "$LIFECYCLE_SCOPE" "$LIFECYCLE_DIFF" 2>/dev/null || _LIFECYCLE_IDENTITY_OK=0
        fi
        if [ "$_LIFECYCLE_IDENTITY_OK" -eq 1 ]; then
            dhpk_lifecycle_mark_artifact_ready "$LIFECYCLE_TASK" "$SUBAGENT_BARE" "$STOP_SESSION_ID" "$LIFECYCLE_ATTEMPT" "$LIFECYCLE_SCOPE" "$LIFECYCLE_DIFF" "$LIFECYCLE_LATEST_ARTIFACT" 2>/dev/null || true
            _LIFECYCLE_VERDICT="$(dhpk_lifecycle_artifact_verdict "$LIFECYCLE_LATEST_ARTIFACT" 2>/dev/null || true)"
            if [ -n "$_LIFECYCLE_VERDICT" ]; then
                dhpk_lifecycle_emit verdicted "$LIFECYCLE_TASK" "$SUBAGENT_BARE" "$STOP_SESSION_ID" "$LIFECYCLE_ATTEMPT" "$LIFECYCLE_SCOPE" "$LIFECYCLE_DIFF" "$_LIFECYCLE_VERDICT" "$LIFECYCLE_LATEST_ARTIFACT" 2>/dev/null || true
            else
                dhpk_lifecycle_emit incomplete "$LIFECYCLE_TASK" "$SUBAGENT_BARE" "$STOP_SESSION_ID" "$LIFECYCLE_ATTEMPT" "$LIFECYCLE_SCOPE" "$LIFECYCLE_DIFF" "" "$LIFECYCLE_LATEST_ARTIFACT" 2>/dev/null || true
            fi
        else
            dhpk_lifecycle_emit incomplete "$LIFECYCLE_TASK" "$SUBAGENT_BARE" "$STOP_SESSION_ID" "$LIFECYCLE_ATTEMPT" "$LIFECYCLE_SCOPE" "$LIFECYCLE_DIFF" "" "$LIFECYCLE_LATEST_ARTIFACT" 2>/dev/null || true
        fi
    else
        dhpk_lifecycle_emit incomplete "$LIFECYCLE_TASK" "$SUBAGENT_BARE" "$STOP_SESSION_ID" "$LIFECYCLE_ATTEMPT" "$LIFECYCLE_SCOPE" "$LIFECYCLE_DIFF" "" "" 2>/dev/null || true
    fi
    # Determine freshness BEFORE any rm below. Clearance requires a fresh,
    # canonical review evidence with a parseable passing verdict; unparseable
    # review evidence
    # remains review debt rather than evidence.
    FRESH_VERDICT="$(has_fresh_parseable_verdict "$SUBAGENT_BARE" "$SENTINEL_FILE")"
    if [ "$FRESH_VERDICT" = "1" ]; then
        # Case B (cleared): subagent succeeded AND a fresh matching review
        # review doc exists — auto-clear the sentinel on the reviewer's behalf.
        # This IS the sanctioned clearance path (reviewer agent definitions no
        # longer instruct a self-run closing clear-sentinel.sh — the auto-mode
        # permission classifier blocks a reviewer running it on its own sentinel
        # as "Logging/Audit Tampering"). It fires at the same moment
        # (SubagentStop) the reviewer's own closing clear would have, scoped
        # strictly to this reviewer's own slot. Delegate to the SSOT clearer
        # (SENTINEL_NAMES whitelist + ldb success record); its stdout MUST be
        # suppressed so its plain text cannot corrupt this hook's single JSON
        # systemMessage envelope (a hook may emit at most one JSON object).
        # Both sides resolve ROOT via _lib/session-env.sh (CLAUDE_PROJECT_DIR
        # inherited by the child), so caller and clearer agree on the sentinel
        # path by construction — no defensive second rm needed. The direct rm
        # remains only as the fallback when the clearer is unavailable or fails.
        # The delegated clearer resets the reminder's escalation rows for this
        # slot itself; the direct-rm fallbacks must do the same, or the counter
        # outlives the clear and re-escalates the next time these files change.
        if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh" ]; then
            bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh" "$SENTINEL_NAME" "subagent-stop-auto" >/dev/null 2>&1 \
                || { sentinel_remove_file "$SENTINEL_FILE"; dhpk_reset_review_backoff "$SESS" "$SENTINEL_NAME"; }
        else
            sentinel_remove_file "$SENTINEL_FILE"
            dhpk_reset_review_backoff "$SESS" "$SENTINEL_NAME"
        fi
        echo "$TIMESTAMP $SUBAGENT exit=0 sentinel=$SENTINEL_NAME (auto-cleared)" >> "$LOG" || true
    else
        # Case B (left armed) — A5: subagent stopped clean but produced NO fresh
        # matching review doc this cycle. Leave the sentinel ARMED so the
        # review gate stays unmet and the orchestrator re-dispatches per the
        # reviewer-liveness-gate no-op rules; log it and record the failure.
        # This deliberately reverses the prior "always clear (must not block the
        # chain)" behavior: a no-output reviewer clearing its own gate was the
        # 2026-07-13 defect this fix (A5) closes.
        # Distinguish "wrote nothing" from "wrote it in the wrong place". The
        # latter used to be reported as the former, which is a false statement
        # that sends the operator to clear-sentinel.sh instead of to the fix.
        MISPLACED_INFO="$(find_misplaced_review_artifact "$SUBAGENT_BARE" "$SENTINEL_NAME" "$STOP_SESSION_ID")"
        IFS=$'\t' read -r MISPLACED MISPLACED_REASON LOG_SESSION LOG_ATTEMPT LOG_DISPATCH <<< "x$MISPLACED_INFO"
        MISPLACED="${MISPLACED#x}"
        LOG_SESSION="${LOG_SESSION:-$DIAG_SESSION_ID}"
        LOG_SESSION="${LOG_SESSION//$'\t'/_}"
        LOG_SESSION="${LOG_SESSION//$'\n'/_}"
        LOG_ATTEMPT="${LOG_ATTEMPT:-unknown}"
        LOG_ATTEMPT="${LOG_ATTEMPT//$'\t'/_}"
        LOG_ATTEMPT="${LOG_ATTEMPT//$'\n'/_}"
        LOG_DISPATCH="${LOG_DISPATCH:-unknown}"
        LOG_DISPATCH="${LOG_DISPATCH//$'\t'/_}"
        LOG_DISPATCH="${LOG_DISPATCH//$'\n'/_}"
        MISPLACED_DETAIL="session=$LOG_SESSION attempt=$LOG_ATTEMPT dispatch=$LOG_DISPATCH reason=$MISPLACED_REASON"
        if [ -n "$MISPLACED" ]; then
            MISPLACED_REL="${MISPLACED#"$ROOT"/}"
            echo "$TIMESTAMP $SUBAGENT exit=0 sentinel=$SENTINEL_NAME (left armed, review doc misplaced: $MISPLACED_REL $MISPLACED_DETAIL)" >> "$LOG" || true
            ldb_record failure "review-doc-misplaced:$SENTINEL_NAME" "$SUBAGENT_BARE $MISPLACED_DETAIL"
            if [ "$PROFILE" != "minimal" ]; then
                emit_system_message "[subagent-verify] MISPLACED REVIEW DOC: $SUBAGENT wrote its review to $MISPLACED_REL ($MISPLACED_REASON), but the canonical location is .claude/artifacts/reviews/<agent>-<yyyymmdd-HHMMSS>-<slug>.md (see the artifacts contract in docs/contracts/).
LEFT $SENTINEL_NAME armed: the doc was not read, and freshness cannot be verified from a non-canonical path. Move it to the canonical path or re-run the reviewer — do NOT clear the sentinel by hand.
Logged to: .claude/artifacts/agent-failures.log"
            fi
        elif [ -n "$MISPLACED_REASON" ] && [ "$MISPLACED_REASON" != "none" ]; then
            echo "$TIMESTAMP $SUBAGENT exit=0 sentinel=$SENTINEL_NAME (left armed, no fresh review doc; misplaced candidate(s) ignored: $MISPLACED_DETAIL)" >> "$LOG" || true
            ldb_record failure "review-doc-no-fresh:$SENTINEL_NAME" "$SUBAGENT_BARE $MISPLACED_DETAIL"
            if [ "$PROFILE" != "minimal" ]; then
                emit_system_message "[subagent-verify] NO FRESH REVIEW DOC: $SUBAGENT stopped clean but no qualifying current misplaced review file was found ($MISPLACED_REASON); LEFT $SENTINEL_NAME armed so the gate stays unmet — re-dispatch the reviewer.
Logged to: .claude/artifacts/agent-failures.log"
            fi
        else
            echo "$TIMESTAMP $SUBAGENT exit=0 sentinel=$SENTINEL_NAME (left armed, no review doc; $MISPLACED_DETAIL)" >> "$LOG" || true
            ldb_record failure "sentinel-uncleared:$SENTINEL_NAME" "$SUBAGENT_BARE $MISPLACED_DETAIL"
            if [ "$PROFILE" != "minimal" ]; then
                emit_system_message "[subagent-verify] NO REVIEW DOC: $SUBAGENT stopped clean but wrote no fresh review doc; LEFT $SENTINEL_NAME armed so the gate stays unmet — re-dispatch the reviewer.
Logged to: .claude/artifacts/agent-failures.log"
            fi
        fi
    fi
fi

if [ "$EXIT_STATUS" = "0" ]; then
    refresh_unresolved_verdict "$SENTINEL_NAME" "$SUBAGENT_BARE"
fi

# Advisory only — never block the chain.
exit 0
