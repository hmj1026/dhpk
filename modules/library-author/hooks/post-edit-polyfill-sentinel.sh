#!/usr/bin/env bash
# post-edit-polyfill-sentinel.sh — library-author module PostToolUse hook.
#
# Goal: route .php edits that touch a runtime version guard
# (version_compare / class_exists / interface_exists / method_exists /
# InstalledVersions::satisfies / PHP_VERSION_ID) to the polyfill-reviewer
# agent via the sixth sentinel slot (.pending-polyfill-review).
#
# Design:
#   - async-friendly: always exit 0; never blocks the edit pipeline.
#   - Silent skip when prerequisites are missing (sessions dir absent, non-.php
#     file, vendor/ path, no guard match in file body).
#   - Cheap: single grep per edit, no fork beyond that.
#
# Trigger criteria (ALL must hold):
#   1. tool_input.file_path ends in .php
#   2. file physically exists (post-Edit/Write)
#   3. file path is NOT under vendor/ or .claude/artifacts/
#   4. file body matches the guard_patterns regex (default catalogue below;
#      override via module.yaml library_author.guard_patterns)
#
# Sentinel format (matches the five existing sentinels written by
# post-edit-remind.sh):
#   <unix-ts> <tool-name> <relative-path>

set -o pipefail

. "$(dirname "$0")/../../../scripts/hooks/_lib/payload.sh"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

PAYLOAD="$(cat 2>/dev/null || true)"
[ -z "$PAYLOAD" ] && exit 0

FILE_PATH="$(extract_tool_input file_path "$PAYLOAD")"
[ -z "$FILE_PATH" ] && FILE_PATH="$(extract_tool_input filePath "$PAYLOAD")"
[ -z "$FILE_PATH" ] && exit 0

# Only .php files.
case "$FILE_PATH" in *.php) ;; *) exit 0 ;; esac

# File must exist (e.g. Edit may target a path that was just deleted).
[ -f "$FILE_PATH" ] || exit 0

# Normalize to repo-relative.
REL="${FILE_PATH#$ROOT/}"

# Hardcoded skips: composer-managed vendor/ and the sentinel sink itself.
case "$REL" in
    vendor/*|*/vendor/*) exit 0 ;;
    .claude/artifacts/*) exit 0 ;;
esac

# Guard pattern: project may override via module.yaml's
# library_author.guard_patterns key. Claude Code exports each plugin option
# under CLAUDE_PLUGIN_OPTION_*, but module-level YAML keys aren't auto-
# exported, so we read the YAML directly with a small grep when the env var
# is absent.
GUARD_PATTERNS="${CLAUDE_PLUGIN_OPTION_LIBRARY_AUTHOR_GUARD_PATTERNS:-}"
if [ -z "$GUARD_PATTERNS" ]; then
    MOD_YAML="$(dirname "$0")/../module.yaml"
    if [ -f "$MOD_YAML" ]; then
        # Match `  guard_patterns: "..."` at any indent inside library_author block.
        GUARD_PATTERNS="$(grep -E '^[[:space:]]*guard_patterns:' "$MOD_YAML" 2>/dev/null \
            | sed -E 's/^[[:space:]]*guard_patterns:[[:space:]]*"([^"]+)".*/\1/' \
            | head -1)"
    fi
fi
# Final fallback — keeps hook functional even if YAML parsing fails.
[ -z "$GUARD_PATTERNS" ] && GUARD_PATTERNS='version_compare|class_exists|interface_exists|method_exists|InstalledVersions::satisfies|PHP_VERSION_ID'

# Does this file actually contain a version guard?
grep -E -q "($GUARD_PATTERNS)" "$FILE_PATH" 2>/dev/null || exit 0

# Sessions directory: only write the sentinel if the project supports
# artifacts (mirror post-edit-remind.sh behaviour — degrade silently if not).
SESS_DIR="$ROOT/.claude/artifacts/sessions"
[ -d "$SESS_DIR" ] || mkdir -p "$SESS_DIR" 2>/dev/null || exit 0
[ -d "$SESS_DIR" ] || exit 0

SENTINEL="$SESS_DIR/.pending-polyfill-review"

# Extract tool name (Edit / Write / MultiEdit) for the sentinel record.
TOOL_NAME="$(printf '%s' "$PAYLOAD" \
    | (command -v jq >/dev/null 2>&1 && jq -r '.tool_name // empty' 2>/dev/null) \
    || true)"
[ -z "$TOOL_NAME" ] && TOOL_NAME="Edit"

TS="$(date +%s)"

# Idempotent append: if the same file is already listed in this sentinel
# session, don't add a duplicate. (Multi-edit within one turn writes one
# line, not three.)
if [ -f "$SENTINEL" ] && grep -qF " $REL" "$SENTINEL" 2>/dev/null; then
    exit 0
fi

printf '%s %s %s\n' "$TS" "$TOOL_NAME" "$REL" >> "$SENTINEL" 2>/dev/null || true

exit 0
