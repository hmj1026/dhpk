#!/usr/bin/env bash
# subagent-stop-verify.sh — SubagentStop hook (non-blocking)
#
# The Review Sentinel auto-clear/reviewer-verification machinery this hook
# used to run (sentinel slot lookup, misplaced-review-doc diagnostics,
# unresolved-verdict sidecar, lifecycle event emission) was entirely keyed to
# `.pending-*` sentinel state and retired with the rest of Sentinel
# (#376/#377) — no Review-Gate-native replacement exists at this hook layer
# today. What remains: clearing a stopped fast-worker's liveness marker, and
# appending one record per stopped subagent (any agent_type) to the dispatch
# log so its effective model/effort is retrievable later. The log write is
# silent (no stdout/stderr, never injected into context) and best-effort.
#
# Trigger: SubagentStop event (wired once in hooks/hooks.json).
# Cost: two jq calls (payload parse + record), no python3/date, <20ms.

set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh"
. "$(dirname "$0")/_lib/payload.sh"

ROOT="$(dhpk_root)"
SESS="$(dhpk_sessions_dir "$ROOT")"

# Read stdin payload (JSON envelope from Claude Code SubagentStop event).
PAYLOAD="$(dhpk_read_payload)"

# One jq call parses every payload field this hook needs, joined by \x1f (a
# non-whitespace IFS char, so empty fields survive `read`). Sets SUBAGENT (the
# first non-empty of the candidate chain) and the dispatch-log fields
# (LOG_ATYPE / LOG_AID / LOG_TPATH / LOG_EFFORT). The SubagentStop envelope
# schema differs across Claude Code versions: the current (verified) schema
# delivers the identity in top-level `agent_type`, prefixed with the plugin
# namespace (e.g. `dhpk:doc-reviewer`); the other candidates are kept for
# back-compat / forward-compat; empty values are skipped like null (the old
# python fallback did the same). LOG_ATYPE deliberately reads agent_type only.
# PARSED_BY_JQ=1 means the fields are authoritative.
SUBAGENT="" LOG_ATYPE="" LOG_AID="" LOG_TPATH="" LOG_EFFORT="" LOG_LASTMSG="" PARSED_BY_JQ=0
INTERRUPT_KIND=""
parse_payload() {
    local payload="$1" fields=""
    [ -z "$payload" ] && return 0
    command -v jq >/dev/null 2>&1 || return 0
    fields="$(printf '%s' "$payload" | jq -r '
        def clean: gsub("[\u001f\n]"; " ");
        def scalar: if type == "object" or type == "array" then error("non-scalar") else tostring | clean end;
        [ (([.agent_type, .subagent_type, .subagent, .agent_name, (.tool_input? | .subagent_type?)]
            | map(select(. != null and . != false and . != "")) | .[0] // "")
           | if type == "string" then . else tojson end | clean),
          ((.agent_type // "") | scalar),
          ((.agent_id // "") | scalar),
          ((.agent_transcript_path // "") | scalar),
          (((.effort // "") | if type == "object" then (.level // "" | tostring) else tostring end) | scalar),
          # last_assistant_message, trimmed; only short messages (<= 400 chars)
          # can be a host interruption notice, longer ones are real reports.
          ((.last_assistant_message // "")
           | if type == "string" then gsub("^\\s+|\\s+$"; "") else "" end
           | if length <= 400 then clean else "" end)
        ] | join("\u001f")' 2>/dev/null)" || return 0
    IFS=$'\x1f' read -r SUBAGENT LOG_ATYPE LOG_AID LOG_TPATH LOG_EFFORT LOG_LASTMSG <<< "$fields"
    # Several concatenated JSON documents print one line each: the name stays
    # unidentified (as before), the log keeps the first document's fields.
    case "$fields" in *$'\n'*) SUBAGENT="" ;; esac
    PARSED_BY_JQ=1
    return 0
}

# No-jq (or jq-failed) fallback for the subagent name only; the dispatch log
# needs jq and is skipped silently without it.
python_subagent_name() {
    local payload="$1" out=""
    [ -z "$payload" ] && return 0
    command -v python3 >/dev/null 2>&1 || return 0
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

# Append one JSONL dispatch record. Skips silently without jq (PARSED_BY_JQ=0).
# effort is the per-subagent SubagentStop hook-input value; the host sends
# {"level": "..."} and the record keeps only the level string. A single jq call
# derives the LAST assistant `message.model` from the tail of the subagent's own
# transcript (tolerating malformed lines and a missing/unreadable file) and
# stamps the UTC time, so no separate date or model-lookup process is needed.
#
# The same jq pass detects a host-generated interruption (rate limit, login,
# API error): the last assistant entry is a "<synthetic>" model message, or the
# short last_assistant_message starts with a known notice. A "<synthetic>" entry
# with unrecognized text (e.g. "No response requested.") is logged as
# interrupt_kind "synthetic_other" with interrupted false and no advisory. It prints
# "<kind>\x1f<record>" (kind empty when not interrupted); the record carries
# `interrupted` / `interrupt_kind`, and the recorded model skips "<synthetic>".
log_subagent_dispatch() {
    local file="$SESS/$DHPK_SIDECAR_SUBAGENT_LOG" size=0 out="" rec=""
    [ "$PARSED_BY_JQ" = 1 ] || return 0
    out="$({
        if [ -n "$LOG_TPATH" ] && [ -r "$LOG_TPATH" ]; then
            # Bound bytes first: one transcript line can be megabytes. A cut
            # first line fails fromjson? and is skipped.
            tail -c 4194304 "$LOG_TPATH" 2>/dev/null | tail -n 200
        fi
    } | jq -R -n -c -j \
        --arg agent_type "$LOG_ATYPE" --arg agent_id "$LOG_AID" --arg effort "$LOG_EFFORT" \
        --arg lastmsg "$LOG_LASTMSG" \
        'def kind_of:
            if test("^You.ve hit your 5-hour limit") then "rate_limit_5h"
            elif test("^You.ve hit your weekly limit") then "rate_limit_weekly"
            elif test("^You.ve hit your (session )?limit") then "rate_limit"
            elif test("^Please run /login") then "auth"
            elif test("^API Error: (401|403)") then "auth"
            elif test("^API Error: (429|5[0-9][0-9])") then "api_error"
            elif test("^Credit balance is too low") then "api_error"
            elif test("^Prompt is too long") then "api_error"
            else "" end;
         def text_of: (.message.content // "")
            | if type == "string" then . elif type == "array" then ([.[] | objects | .text? | strings] | join(" ")) else "" end
            | gsub("^\\s+|\\s+$"; "");
         [inputs | fromjson? | select(type == "object" and .type == "assistant")] as $asst
         | ($asst | last) as $lastA
         | ([$asst[] | .message.model // empty | select(. != "<synthetic>")] | last // "") as $model
         | (($lastA != null) and (($lastA.message.model // "") == "<synthetic>")) as $synthetic
         | (if $synthetic then (($lastA | text_of | kind_of) as $k | if $k != "" then $k else ($lastmsg | kind_of) end) else ($lastmsg | kind_of) end) as $k2
         | (if $k2 != "" then $k2 elif $synthetic then "synthetic_other" else "" end) as $kind
         | (($kind != "") and ($kind != "synthetic_other")) as $interrupted
         | (if $interrupted then $kind else "" end), "\u001f",
           ({ts: (now | gmtime | strftime("%Y-%m-%dT%H:%M:%SZ")),
          agent_type: (if $agent_type == "" then null else $agent_type end),
          agent_id: (if $agent_id == "" then null else $agent_id end),
          model: (if $model == "" then null else $model end),
          model_source: "agent_transcript",
          effort: (if $effort == "" then null else $effort end),
          effort_source: (if $effort == "" then null else "hook_input" end),
          interrupted: $interrupted,
          interrupt_kind: (if $kind == "" then null else $kind end)} | tojson)' 2>/dev/null)" || out=""
    [ -n "$out" ] || return 0
    INTERRUPT_KIND="${out%%$'\x1f'*}"
    rec="${out#*$'\x1f'}"
    mkdir -p "$SESS" 2>/dev/null || return 0
    if [ -f "$file" ]; then
        size="$(wc -c < "$file" 2>/dev/null)"
        size="${size//[[:space:]]/}"
        [ "${size:-0}" -gt 1048576 ] && mv -f "$file" "$file.1" 2>/dev/null
    fi
    printf '%s\n' "$rec" >> "$file" 2>/dev/null || true
    return 0
}

# One advisory systemMessage (never a decision/block) when the subagent ended on
# a host interruption: its output is a notice, not a result.
emit_interrupt_advisory() {
    [ -n "$INTERRUPT_KIND" ] || return 0
    . "$(dirname "$0")/_lib/json-out.sh"
    emit_system_message "dhpk: subagent ${LOG_ATYPE:-${SUBAGENT:-unknown}} (${LOG_AID:-unknown}) INTERRUPTED (${INTERRUPT_KIND}) — not a result; partial edits may be on disk; inspect its assigned files (git status/diff) before re-dispatch."
}

parse_payload "$PAYLOAD"
log_subagent_dispatch >/dev/null 2>&1 || true

# jq absent or its parse failed: recover the name via python3 (clearing the
# fast-worker liveness marker must still work without jq).
[ "$PARSED_BY_JQ" = 1 ] || SUBAGENT="$(python_subagent_name "$PAYLOAD")"

case "${SUBAGENT##*:}" in
    fast-worker|codex-worker|agy-worker)
        remove_matching_active_entry "$SESS/$DHPK_SIDECAR_FAST_WORKER_ACTIVE" "$SUBAGENT"
        ;;
esac

emit_interrupt_advisory

exit 0
