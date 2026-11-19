#!/usr/bin/env bash
# json-out.sh — build Claude Code hook JSON stdout payloads.
# Source-only — never execute directly. No side effects on sourcing.
#
# Verified on Claude Code 2.1.193 (see memory reference_hook_output_channels):
#   * exit 0 + stderr            → logged only (hook_success.stderr), NOT surfaced.
#   * stdout {"systemMessage":…} → promoted to hook_system_message (USER sees it).
#   * stdout {…additionalContext…} → promoted to hook_additional_context
#                                    (injected into the MODEL's context).
#   * exit 2 + stderr            → fed back to Claude AND blocks (blockable events).
#
# So advisory hooks that want to be SEEN must emit JSON here, not `echo >&2`.
# A hook may emit at most ONE JSON object on stdout; do not mix with other
# stdout writes or Claude Code can't parse it.
#
# Helpers:
#   emit_system_message "<text>"
#       → user-facing notice. No-op on empty text.
#   emit_additional_context "<EventName>" "<text>"
#       → context injected for the model. No-op on empty text.
#   json_escape "<raw>"
#       → prints a JSON string literal (with surrounding quotes), UTF-8 safe.

# json_escape <raw> — echo a fully-quoted JSON string literal. python3 (json.dumps)
# is preferred for correct unicode + control-char handling; jq -Rs is the
# fallback; a minimal bash escape is the last resort so the function never fails.
json_escape() {
    local raw="$1"
    if command -v python3 >/dev/null 2>&1; then
        RAW="$raw" python3 -c 'import os,json,sys; sys.stdout.write(json.dumps(os.environ.get("RAW","")))' 2>/dev/null && return 0
    fi
    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$raw" | jq -Rs . 2>/dev/null && return 0
    fi
    raw="${raw//\\/\\\\}"
    raw="${raw//\"/\\\"}"
    raw="${raw//$'\r'/}"
    raw="${raw//$'\n'/\\n}"
    printf '"%s"' "$raw"
    return 0
}

# emit_system_message <text> — user-visible notice (hook_system_message).
emit_system_message() {
    local msg="$1" esc
    [ -z "$msg" ] && return 0
    esc="$(json_escape "$msg")"
    printf '{"systemMessage":%s}\n' "$esc"
    return 0
}

# emit_additional_context <EventName> <text> — context injected for the model.
emit_additional_context() {
    local event="$1" ctx="$2" esc_event esc_ctx
    [ -z "$ctx" ] && return 0
    esc_event="$(json_escape "$event")"
    esc_ctx="$(json_escape "$ctx")"
    printf '{"hookSpecificOutput":{"hookEventName":%s,"additionalContext":%s}}\n' "$esc_event" "$esc_ctx"
    return 0
}
