#!/usr/bin/env bash
# subagent-stop-quality.sh — SubagentStop hook (default-OFF quality gate)
#
# Ports repo-harness's `.ai/hooks/subagent-stop-quality.sh` (bun/JS) to bash+jq
# for dhpk (no bun dependency; the source's `HOOK_HOST=codex` gate is
# dhpk-inapplicable and dropped, not translated — see design.md Decision d).
#
# Blocks-and-continues a subagent whose final report is thin/evidence-free,
# so `subagent-stop-verify.sh` (wired AFTER this hook in hooks.json) never
# auto-clears a reviewer's sentinel on a no-op reply. Default OFF via
# CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE — must be explicitly enabled.
#
# Trigger: SubagentStop event (wired in hooks/hooks.json, BEFORE
# subagent-stop-verify.sh).
#
# Field ordering below matches the empirical probe in
# openspec/changes/consolidate-hooks-delegation-verdicts/probe-results.md —
# NOT the design.md's original assumed ordering.

set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh"
ROOT="$(dhpk_root)"
# Project overrides must be loaded before the gate decision. payload.sh supplies
# the reviewer roster used to scope this advisory to reviewer sentinels only.
. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"

# Task 4.7 — gate check FIRST, before any extraction or heuristic work.
GATE="${CLAUDE_PLUGIN_OPTION_SUBAGENT_QUALITY_GATE:-off}"
case "$(printf '%s' "$GATE" | tr '[:upper:]' '[:lower:]')" in
    on|true|1) ;;
    *) exit 0 ;;
esac

command -v jq >/dev/null 2>&1 || exit 0

SESS="$(dhpk_sessions_dir "$ROOT")"
STATE_FILE="$SESS/.subagent-stop-quality-state.json"
COUNTER_FILE="$SESS/.subagent-stop-quality-extraction.json"

# shellcheck source=/dev/null
. "$(dirname "$0")/_lib/json-out.sh"

PAYLOAD="$(dhpk_read_payload)"
[ -n "$PAYLOAD" ] || exit 0

# Task 4.4 — honor stop_hook_active / subagent_stop_hook_active (prevents a
# re-block loop on the continuation turn Claude Code generates after a block).
STOP_ACTIVE="$(printf '%s' "$PAYLOAD" | jq -r '
    if (.stop_hook_active == true) or (.subagent_stop_hook_active == true) then "true" else "false" end
' 2>/dev/null || echo false)"
[ "$STOP_ACTIVE" = "true" ] && exit 0

# Task 4.6 — scope to delegation agents only (same candidate chain as
# subagent-stop-verify.sh, namespace-strip via ${SUBAGENT##*:}).
SUBAGENT="$(printf '%s' "$PAYLOAD" | jq -r '
    .agent_type // .subagent_type // .subagent // .agent_name // .tool_input.subagent_type // empty
' 2>/dev/null || true)"
[ -n "$SUBAGENT" ] || exit 0
SUBAGENT_BARE="${SUBAGENT##*:}"

IS_REVIEWER=0
for _reviewer in "${SENTINEL_AGENTS[@]}"; do
    [ "${_reviewer##*:}" = "$SUBAGENT_BARE" ] && IS_REVIEWER=1 && break
done
[ "$IS_REVIEWER" -eq 1 ] || exit 0

mkdir -p "$SESS" 2>/dev/null || true

record_extraction() {
    # $1 = hit|miss — best-effort atomic-ish increment (SubagentStop calls are
    # not expected to race within a session; a lost update here only skews the
    # rollout-flip counter slightly, never a functional gate outcome).
    local kind="$1" hits=0 misses=0
    if [ -f "$COUNTER_FILE" ]; then
        hits="$(jq -r '.hits // 0' "$COUNTER_FILE" 2>/dev/null || echo 0)"
        misses="$(jq -r '.misses // 0' "$COUNTER_FILE" 2>/dev/null || echo 0)"
    fi
    case "$kind" in
        hit)  hits=$((hits + 1)) ;;
        miss) misses=$((misses + 1)) ;;
    esac
    jq -n --argjson h "$hits" --argjson m "$misses" '{hits:$h,misses:$m}' > "$COUNTER_FILE" 2>/dev/null || true
}

# Task 4.1/4.8 — layered extraction, ordered per probe-results.md:
# last_assistant_message (CONFIRMED present) FIRST, others are compat.
TEXT="$(printf '%s' "$PAYLOAD" | jq -r '
    .last_assistant_message // .final_message // .subagent_result // .result //
    .response // .output // .message // .assistant_message // empty
' 2>/dev/null || true)"

if [ -z "$TEXT" ]; then
    # Step 2 — transcript tail fallback. Prefer the subagent's own transcript
    # (agent_transcript_path) over the parent-session transcript_path.
    TX_PATH="$(printf '%s' "$PAYLOAD" | jq -r '.agent_transcript_path // .transcript_path // empty' 2>/dev/null || true)"
    if [ -n "$TX_PATH" ] && [ -f "$TX_PATH" ]; then
        TEXT="$(tail -n 200 "$TX_PATH" 2>/dev/null | jq -rs '
            [ .[] | select(.type == "assistant") ] as $asst
            | if ($asst | length) > 0 then
                ($asst[-1].message.content // []) as $content
                | [ $content[] | select(.type == "text") | .text ] | join("\n")
              else empty end
        ' 2>/dev/null || true)"
    fi
fi

if [ -z "$TEXT" ]; then
    record_extraction miss
    exit 0
fi
record_extraction hit

TRIMMED="$(printf '%s' "$TEXT" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
[ -n "$TRIMMED" ] || exit 0

# Task 4.2 — four heuristics (English-only; drop source's CJK synonyms).
LEN="${#TRIMMED}"
REASON=""

if [ "$LEN" -lt 120 ]; then
    REASON="The subagent final report is too thin for repo-harness delegation."
elif printf '%s' "$TRIMMED" | grep -Eiq '^(looks good|lgtm|ok|done|no issues|all good)[.![:space:]]*$'; then
    REASON="The subagent final report is too thin for repo-harness delegation."
elif printf '%s' "$TRIMMED" | grep -Eiq '\b(error|failed|failure|blocked|exception|timeout)\b' \
    && ! printf '%s' "$TRIMMED" | grep -Eiq '\b(risk|uncertain|recommend|next|because)\b'; then
    REASON="The subagent reported an unresolved error without a risk or parent-action recommendation."
elif printf '%s' "$TRIMMED" | grep -Eiq '\b(review|explore|investigate|audit|map)\b' \
    && ! printf '%s' "$TRIMMED" | grep -Eq '([A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+|\.[A-Za-z0-9]+\b|:[0-9]+\b|`[^`]+`|\b(symbols?|files?|evidence|tests?|commands?)\b)'; then
    REASON="The subagent report lacks file, symbol, command, or evidence references."
fi

[ -n "$REASON" ] || exit 0

# Task 4.3 — bounded reviewer retry keyed on session:subagent. The first thin
# reviewer report is blocked once; the continuation is allowed to reach the
# sentinel verifier, which keeps the no-op gate pending if no review output exists.
SESSION_ID="$(printf '%s' "$PAYLOAD" | jq -r '.session_id // .run_id // .transcript_path // empty' 2>/dev/null || true)"
[ -n "$SESSION_ID" ] || SESSION_ID="unscoped-session"
DISPATCH_ID="$(printf '%s' "$PAYLOAD" | jq -r '.agent_id // .subagent_id // .transcript_path // empty' 2>/dev/null || true)"
HASH="$(printf '%s' "$TRIMMED" | sha1sum 2>/dev/null | awk '{print $1}')"
[ -n "$HASH" ] || HASH="$(printf '%s' "$TRIMMED" | shasum 2>/dev/null | awk '{print $1}')"
[ -n "$DISPATCH_ID" ] || DISPATCH_ID="$HASH"
SCOPE_KEY="${SESSION_ID}:${SUBAGENT_BARE}:${DISPATCH_ID}"

if [ -f "$STATE_FILE" ]; then
    LAST_SCOPE="$(jq -r '.last_blocked_scope // empty' "$STATE_FILE" 2>/dev/null || true)"
    BLOCK_COUNT="$(jq -r '.block_count // 0' "$STATE_FILE" 2>/dev/null || echo 0)"
    [ "$LAST_SCOPE" = "$SCOPE_KEY" ] && [ "$BLOCK_COUNT" -ge 1 ] && exit 0
fi

jq -n --arg scope "$SCOPE_KEY" --arg hash "$HASH" --arg subagent "$SUBAGENT_BARE" \
    '{version:1,last_blocked_scope:$scope,last_blocked_hash:$hash,block_count:1,scope:{subagent:$subagent}}' \
    > "$STATE_FILE" 2>/dev/null || true

# Task 4.5 — exactly ONE JSON object on stdout, raw (not emit_system_message).
REASON_TEXT="[SubagentQualityGate] ${REASON} Continue the subagent once and return a complete final response with: files and symbols inspected, evidence, risks or uncertainty, tests or commands run when relevant, and recommended parent action. Do not claim overall task completion."
REASON_JSON="$(json_escape "$REASON_TEXT")"
printf '{"decision":"block","reason":%s}\n' "$REASON_JSON"

exit 0
