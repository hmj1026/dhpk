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

. "$(dirname "$0")/_lib/session-env.sh"
. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/transcript.sh"
. "$(dirname "$0")/_lib/json-out.sh"

ROOT="$(dhpk_root)"
. "$(dirname "$0")/_lib/load-project-config.sh" 2>/dev/null || true

# Opt-in gate (env override > userConfig > default off).
_enabled="$(dhpk_config_bool completion_evidence_enabled false DHPK_COMPLETION_EVIDENCE)"
[ "$_enabled" = "true" ] || exit 0

# minimal profile suppresses all advisory output.
PROFILE="$(dhpk_config_profile)"
[ "$PROFILE" = "minimal" ] && exit 0

SESS="$(dhpk_sessions_dir "$ROOT")"
PAYLOAD="$(dhpk_read_payload)"

# transcript path extraction lives in _lib/transcript.sh (shared with
# stop-graduation-scan.sh).
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

# Compare against git diff (HEAD vs working tree, staged + unstaged) PLUS
# untracked-but-not-ignored files, so a brand-new test file (e.g. an untracked
# *.spec.js added by a TDD flow) counts as test evidence instead of being
# invisible. The two sets are disjoint (tracked/staged vs untracked), so
# concatenating them cannot double-count; --exclude-standard honors .gitignore.
diff_files="$(cd "$ROOT" && { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } || true)"
[ -z "$diff_files" ] && exit 0

# Classify code vs test. The exclude regex groups (^|/)tests?/ explicitly so
# root-level *Test.php files don't slip past the alternation.
code_files="$(printf '%s\n' "$diff_files" | grep -E '\.(php|js|ts|jsx|tsx|py|rb|go|rs|java|kt|swift)$' | grep -vE '(Test\.php$|\.test\.(js|ts|jsx|tsx)$|\.spec\.(js|ts|jsx|tsx)$|_test\.(py|go)$|(^|/)tests?/|/__tests__/|(^|/)spec/)' || true)"
test_files="$(printf '%s\n' "$diff_files" | grep -E '(Test\.php$|\.test\.(js|ts|jsx|tsx)$|\.spec\.(js|ts|jsx|tsx)$|_test\.(py|go)$|(^|/)tests?/|/__tests__/|(^|/)spec/)' || true)"

# No code change (doc-only / harness / spec edits) → no test evidence needed.
[ -z "$code_files" ] && exit 0

# Code change with test change → evidence present.
[ -n "$test_files" ] && exit 0

# Code change + completion claim + zero test changes → warn.
code_count="$(printf '%s' "$code_files" | grep -c . 2>/dev/null || echo 0)"
sample="$(printf '%s\n' "$code_files" | head -3 | sed 's/^/    - /')"
extra=""
[ "$code_count" -gt 3 ] && extra="    ... and $((code_count - 3)) more file(s)"

msg="[completion-evidence] COMPLETION CLAIM without test evidence.
The assistant claimed completion, but git diff shows $code_count code file(s) changed with no test changes:
$sample"
[ -n "$extra" ] && msg="$msg
$extra"
msg="$msg

If this was a refactor / dead-code removal / doc-only path, ignore this.
Otherwise: add a failing-first test (tdd-guide) or run /verify."

# Advisory only — never block Stop. systemMessage so the user decides (exit-0
# stderr is inert; see _lib/json-out.sh).
emit_system_message "$msg"
exit 0
