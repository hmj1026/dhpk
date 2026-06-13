#!/usr/bin/env bash
# stop-completion-evidence.sh — Stop hook (advisory only, opt-in).
#
# Detects when the assistant claims completion ("done" / "fixed" / "已完成")
# in this session while the working tree shows source-code changes with NO
# matching test changes — and prints a stderr warning. Advisory only (exit 0);
# it never blocks Stop, and it does NOT replace the reviewer chain or /verify.
#
# Design:
# - stdin payload → transcript_path → scan the last N assistant messages
# - completion-claim keyword match (English + Traditional Chinese)
# - if any review sentinel is active, stop-review-reminder.sh already owns the
#   warning — skip to avoid double output
# - compare `git diff --name-only HEAD`: code changes without test changes →
#   warn; doc-only / .claude/ / openspec/ changes are exempt (no test needed)
#
# Opt-in: userConfig.completion_evidence_enabled (default false).
# One-shot override: DHPK_COMPLETION_EVIDENCE=1/0.
# Cost: transcript JSONL tail + one git diff, <200ms.

set -o pipefail

. "$(dirname "$0")/_lib/payload.sh"

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
. "$(dirname "$0")/_lib/load-project-config.sh" 2>/dev/null || true

# Opt-in gate (env override > userConfig > default off).
_enabled="${CLAUDE_PLUGIN_OPTION_COMPLETION_EVIDENCE_ENABLED:-false}"
case "${DHPK_COMPLETION_EVIDENCE:-}" in
    1|true)  _enabled="true" ;;
    0|false) _enabled="false" ;;
esac
[ "$_enabled" = "true" ] || exit 0

# minimal profile suppresses all advisory output.
PROFILE="${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-standard}"
[ "$PROFILE" = "minimal" ] && exit 0

SESS="$ROOT/.claude/artifacts/sessions"
PAYLOAD="$(cat 2>/dev/null || true)"

# Pull transcript_path from the payload (schema variants + env fallback).
extract_transcript_path() {
    local payload="$1" out=""
    [ -z "$payload" ] && return 0
    if command -v jq >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | jq -r '.transcript_path // .transcript // empty' 2>/dev/null || true)"
    fi
    if [ -z "$out" ] && command -v python3 >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get("transcript_path") or d.get("transcript") or "")
except Exception:
    pass
' 2>/dev/null || true)"
    fi
    [ -z "$out" ] && out="${CLAUDE_TRANSCRIPT_PATH:-}"
    printf '%s' "$out"
}

TRANSCRIPT="$(extract_transcript_path "$PAYLOAD")"
[ -z "$TRANSCRIPT" ] && exit 0
[ -f "$TRANSCRIPT" ] || exit 0

# Active sentinels → stop-review-reminder.sh already owns the reminder.
for name in "${SENTINEL_NAMES[@]}"; do
    if [ -f "$SESS/$name" ]; then
        exit 0
    fi
done

# Grab the text of the last N transcript lines' assistant messages.
TAIL_LINES=80
recent_assistant_text=""
if command -v jq >/dev/null 2>&1; then
    recent_assistant_text="$(tail -n "$TAIL_LINES" "$TRANSCRIPT" 2>/dev/null | jq -r '
        select(.role == "assistant" or .type == "assistant")
        | (.content // .message.content // [])
        | if type == "array"
          then map(if type == "object" and .type == "text" then .text else (. | tostring) end) | join("\n")
          else (. | tostring)
          end
    ' 2>/dev/null | tr '\n' ' ' | tr -s ' ' || true)"
fi
# Fallback: raw tail (jq missing or parse failed).
if [ -z "$recent_assistant_text" ]; then
    recent_assistant_text="$(tail -n "$TAIL_LINES" "$TRANSCRIPT" 2>/dev/null | tr '\n' ' ' || true)"
fi

# Completion-claim keywords (English + Traditional Chinese). Word boundaries
# via trailing space/period so "donate" / "donor" don't trip "done".
claim_pattern='(已完成|已修[復正完]|完成了|完成。|completed[[:space:]\.]|implemented[[:space:]\.]|all done|task done|done[[:space:]\.]|step.*complete|fix(ed)?[[:space:]\.]|shipped[[:space:]\.])'
if ! printf '%s' "$recent_assistant_text" | grep -qiE "$claim_pattern"; then
    exit 0
fi

# Compare against git diff (HEAD vs working tree, staged + unstaged).
diff_files="$(cd "$ROOT" && git diff --name-only HEAD 2>/dev/null || true)"
[ -z "$diff_files" ] && exit 0

# Classify code vs test. The exclude regex groups (^|/)tests?/ explicitly so
# root-level *Test.php files don't slip past the alternation.
code_files="$(printf '%s\n' "$diff_files" | grep -E '\.(php|js|ts|jsx|tsx|py|rb|go|rs|java|kt|swift)$' | grep -vE '(Test\.php$|\.test\.(js|ts|jsx|tsx)$|_test\.(py|go)$|(^|/)tests?/|/__tests__/|(^|/)spec/)' || true)"
test_files="$(printf '%s\n' "$diff_files" | grep -E '(Test\.php$|\.test\.(js|ts|jsx|tsx)$|_test\.(py|go)$|(^|/)tests?/|/__tests__/|(^|/)spec/)' || true)"

# No code change (doc-only / harness / spec edits) → no test evidence needed.
[ -z "$code_files" ] && exit 0

# Code change with test change → evidence present.
[ -n "$test_files" ] && exit 0

# Code change + completion claim + zero test changes → warn.
code_count="$(printf '%s' "$code_files" | grep -c . 2>/dev/null || echo 0)"
sample="$(printf '%s\n' "$code_files" | head -3 | sed 's/^/    - /')"
extra=""
[ "$code_count" -gt 3 ] && extra="    ... and $((code_count - 3)) more file(s)"

echo >&2 ""
echo >&2 "-----------------------------------------------------------"
echo >&2 "[WARN] COMPLETION CLAIM without test evidence"
echo >&2 "   The assistant claimed completion, but git diff shows $code_count code file(s) changed with no test changes:"
echo >&2 "$sample"
[ -n "$extra" ] && echo >&2 "$extra"
echo >&2 ""
echo >&2 "   If this was a refactor / dead-code removal / doc-only path, ignore this."
echo >&2 "   Otherwise: add a failing-first test (tdd-guide) or run /verify."
echo >&2 "-----------------------------------------------------------"

# Advisory only — never block Stop.
exit 0
