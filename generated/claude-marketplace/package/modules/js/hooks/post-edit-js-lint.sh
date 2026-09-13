#!/usr/bin/env bash
# post-edit-js-lint.sh — JS module PostToolUse (Edit/Write/MultiEdit) hook.
#
# Goal: surface ESLint findings for JS/TS edits without waiting for commit / CI.
#
# Two modes (DHPK_JS_LINT_MODE, default "batch"):
#   - batch (default): record the edited frontend path into a per-session
#     accumulator and return immediately. The actual ESLint (+ optional
#     typecheck) runs ONCE at Stop via stop-js-batch-check.sh — so editing N
#     files in one response lints once at the end instead of N times mid-stream.
#   - per-edit: lint this single file right now (the legacy behaviour). Use when
#     you want immediate per-file feedback and don't mind redundant runs.
#
# Design:
#   - async-friendly: always exit 0; never blocks the edit pipeline.
#   - Silent skip when any prerequisite is missing (no `npx`, no
#     `eslint.config.js`, non-frontend tier). Avoid noise on every edit.
#   - Tier source-of-truth: hooks/_lib/js-tier-detect.sh (shared with future
#     JS-module hooks).
#   - 10s timeout to keep the edit pipeline snappy even on very large files.

set -o pipefail

. "$(dirname "$0")/../../../scripts/hooks/_lib/payload.sh"
. "$(dirname "$0")/_lib/js-tier-detect.sh"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

PAYLOAD="$(cat 2>/dev/null || true)"
[ -z "$PAYLOAD" ] && exit 0

FILE_PATH="$(extract_tool_input file_path "$PAYLOAD")"
[ -z "$FILE_PATH" ] && FILE_PATH="$(extract_tool_input filePath "$PAYLOAD")"
[ -z "$FILE_PATH" ] && exit 0

REL="${FILE_PATH#$ROOT/}"

detect_js_tier "$REL"
[ "$JS_TIER" = "frontend" ] || exit 0

[ -f "$FILE_PATH" ] || exit 0

# Batch mode (default): accumulate the path and defer the lint to Stop.
if [ "${DHPK_JS_LINT_MODE:-batch}" != "per-edit" ]; then
    ACC_DIR="$ROOT/.claude/artifacts/sessions"
    ACC_FILE="$ACC_DIR/.js-pending-check"
    mkdir -p "$ACC_DIR" 2>/dev/null || exit 0
    # Dedup: only append if not already queued this session.
    if [ ! -f "$ACC_FILE" ] || ! grep -Fxq -- "$REL" "$ACC_FILE" 2>/dev/null; then
        printf '%s\n' "$REL" >> "$ACC_FILE" 2>/dev/null || true
    fi
    exit 0
fi

# per-edit mode: lint this single file immediately (legacy behaviour).
command -v npx >/dev/null 2>&1 || exit 0
[ -f "$ROOT/eslint.config.js" ] || [ -f "$ROOT/eslint.config.mjs" ] || [ -f "$ROOT/eslint.config.cjs" ] || exit 0

cd "$ROOT" || exit 0
OUTPUT=""
if command -v timeout >/dev/null 2>&1; then
    OUTPUT="$(timeout 10 npx --no-install eslint "$REL" 2>&1 || true)"
else
    # macOS without GNU coreutils: no `timeout`. Run unbounded — file-level
    # ESLint is normally < 1s; tier filtering already excludes vendored bundles.
    OUTPUT="$(npx --no-install eslint "$REL" 2>&1 || true)"
fi

if echo "$OUTPUT" | grep -qE '^\s*[0-9]+\s+problems?\s*\(|✖ [0-9]+\s+problems?'; then
    COUNT="$(echo "$OUTPUT" | grep -oE '[0-9]+ problems?' | head -1)"
    echo "[js-lint] ⚠ ESLint ${COUNT:-issues} in $REL (fix before commit)" >&2
    echo "$OUTPUT" | grep -E '^\s+[0-9]+:[0-9]+\s+(error|warning)' | head -5 | sed 's/^/  /' >&2
elif echo "$OUTPUT" | grep -q 'Parsing error\|Cannot find module'; then
    echo "[js-lint] WARN: eslint could not parse $REL (parser/config issue — silent skip)" >&2
fi

exit 0
