#!/usr/bin/env bash
# post-edit-swiftlint.sh — xcode-tooling module PostToolUse (Edit/Write/MultiEdit) hook.
#
# Goal: surface SwiftLint findings right after a .swift edit instead of waiting
# for commit / CI.
#
# Design (mirrors modules/js/hooks/post-edit-js-lint.sh):
#   - async-friendly: always exit 0; never blocks the edit pipeline.
#   - Silent self-skip when any prerequisite is missing (no swiftlint binary,
#     non-.swift file, file gone). Avoids noise on machines without SwiftLint.
#   - 10s timeout to keep the edit pipeline snappy on large files.
#
# Config (overridable via userConfig / project settings.local.json):
#   CLAUDE_PLUGIN_OPTION_SWIFTLINT_BIN   ("swiftlint")

set -o pipefail

. "$(dirname "$0")/../../../scripts/hooks/_lib/payload.sh"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
# Re-load project config so swiftlint_bin reflects a per-project override even
# when this hook is invoked outside the dispatcher (e.g. a manual test run).
. "$(dirname "$0")/../../../scripts/hooks/_lib/load-project-config.sh"

PAYLOAD="$(cat 2>/dev/null || true)"
[ -z "$PAYLOAD" ] && exit 0

FILE_PATH="$(extract_tool_input file_path "$PAYLOAD")"
[ -z "$FILE_PATH" ] && FILE_PATH="$(extract_tool_input filePath "$PAYLOAD")"
[ -z "$FILE_PATH" ] && exit 0

case "$FILE_PATH" in *.swift) ;; *) exit 0 ;; esac
[ -f "$FILE_PATH" ] || exit 0

SWIFTLINT="${CLAUDE_PLUGIN_OPTION_SWIFTLINT_BIN:-swiftlint}"
command -v "$SWIFTLINT" >/dev/null 2>&1 || exit 0

REL="${FILE_PATH#$ROOT/}"
cd "$ROOT" || exit 0

OUTPUT=""
if command -v timeout >/dev/null 2>&1; then
    OUTPUT="$(timeout 10 "$SWIFTLINT" lint --quiet --path "$REL" 2>/dev/null || true)"
else
    # macOS without GNU coreutils: no `timeout`. File-level lint is normally <1s.
    OUTPUT="$("$SWIFTLINT" lint --quiet --path "$REL" 2>/dev/null || true)"
fi

# SwiftLint emits `path:line:col: warning|error: message (rule_id)` per violation.
COUNT="$(printf '%s\n' "$OUTPUT" | grep -cE ': (warning|error): ' || true)"
if [ "${COUNT:-0}" -gt 0 ]; then
    echo "[swiftlint] ⚠ $COUNT issue(s) in $REL (fix before commit)" >&2
    printf '%s\n' "$OUTPUT" | grep -E ': (warning|error): ' | head -5 | sed 's/^/  /' >&2
fi

exit 0
