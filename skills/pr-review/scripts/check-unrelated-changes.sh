#!/usr/bin/env bash
# check-unrelated-changes.sh — advisory PR description scanner
#
# Usage:
#   bash .claude/skills/pr-review/scripts/check-unrelated-changes.sh <pr-number>
#
# Behavior:
#   1. 偵測 PR 是否為 squash merge（gh pr view → mergeStateStatus / commits=1）
#   2. 若是 squash + PR description 缺 `## Unrelated Changes` 段 → stdout 印 warning + 列疑似 unrelated 檔案集合
#   3. 若非 squash → 印 `[skip] not a squash merge` 並退出 0
#   4. 退出碼永遠 0（advisory only，不阻擋 merge）
#
# Source: openspec/changes/verify-zpos-modular-refactor-followup/specs/squash-merge-hygiene/spec.md
#         Requirement "pr-review skill MUST provide automated unrelated-changes scanner"

set -uo pipefail

PR_NUMBER="${1:-}"

if [[ -z "$PR_NUMBER" ]]; then
    echo "[error] Usage: $0 <pr-number>"
    echo "        Example: $0 42"
    exit 0   # advisory: 不阻擋
fi

# ---- Step 1: 偵測 PR squash 與否（git-only，per spec squash-merge-hygiene） ----
#
# Strategy (spec order):
#   1. (Primary, git-only) commit message 含 squash 標籤：`Squash merge of` / `(#N)` 結尾
#   2. (Optional 補強) gh CLI 可用時用 commits 陣列長度 == 1 作 secondary check
#
# 注意：`commit_count == 1` **不等於** squash merge — 單一 commit 的普通 PR 也是 1；
# 故 spec 把 commit message pattern 列為主，commits == 1 僅當作 corroborating evidence

is_squash=0
commit_count=""

# (1) Primary git-only detection — latest commit message
latest_msg="$(git log -1 --pretty=%B 2>/dev/null || echo '')"
if echo "$latest_msg" | grep -qE '^Squash merge of|\(#[0-9]+\)\s*$'; then
    is_squash=1
fi

# (2) Optional 補強：gh CLI commits.length == 1 ∧ message 含 PR 編號樣態
if [[ "$is_squash" -ne 1 ]] && command -v gh > /dev/null 2>&1; then
    commit_count="$(gh pr view "$PR_NUMBER" --json commits --jq '.commits | length' 2>/dev/null || echo "")"
    # 僅當「commits==1」且「latest commit message 包含 PR 編號 (#N)」時才視為 squash 樣板
    if [[ "$commit_count" == "1" ]] && echo "$latest_msg" | grep -qE '\(#[0-9]+\)'; then
        is_squash=1
    fi
fi

if [[ "$is_squash" -ne 1 ]]; then
    echo "[skip] not a squash merge (commits=${commit_count:-unknown}); unrelated-changes check skipped"
    exit 0
fi

# ---- Step 2: 取 PR description 並 grep `## Unrelated Changes` 段 ----

pr_body=""
if command -v gh > /dev/null 2>&1; then
    pr_body="$(gh pr view "$PR_NUMBER" --json body --jq '.body' 2>/dev/null || echo '')"
fi

if [[ -z "$pr_body" ]]; then
    echo "[warn] could not fetch PR description for #$PR_NUMBER; cannot verify Unrelated Changes section"
    exit 0
fi

# CRLF 容錯：gh CLI 在 Windows / macOS-via-WSL 可能回傳 \r\n；fixed-string grep + CRLF strip 雙保險
pr_body_normalized="$(echo "$pr_body" | tr -d '\r')"
if echo "$pr_body_normalized" | grep -qF '## Unrelated Changes'; then
    echo "[ok] squash PR #$PR_NUMBER contains '## Unrelated Changes' section"
    exit 0
fi

# ---- Step 3: 缺段；印 warning + 列疑似 unrelated 檔案 ----

echo ""
echo "[warn] SQUASH PR #$PR_NUMBER MISSING '## Unrelated Changes' SECTION"
echo ""
echo "    Per spec 'squash-merge-hygiene' (openspec/changes/verify-zpos-modular-refactor-followup/specs/squash-merge-hygiene/spec.md),"
echo "    squash merge PR descriptions MUST list all functionally unrelated change groups + assigned reviewers."
echo ""
echo "    This is ADVISORY ONLY — the warning does NOT block merge. Reviewer judgment determines whether listed changes are truly unrelated."
echo ""

# 嘗試列出 PR diff 的檔案
if command -v gh > /dev/null 2>&1; then
    files="$(gh pr view "$PR_NUMBER" --json files --jq '.files[].path' 2>/dev/null || echo '')"
    if [[ -n "$files" ]]; then
        file_count="$(echo "$files" | wc -l | tr -d ' ')"
        echo "    Files changed in this PR ($file_count total):"
        echo "$files" | head -30 | sed 's/^/      · /'
        if [[ "$file_count" -gt 30 ]]; then
            echo "      ... ($((file_count - 30)) more files truncated)"
        fi
    fi
fi

echo ""
echo "    Reference:"
echo "      · execution-policy.md \"Git pipeline\" — squash merge hard rule"
echo "      · docs/refactor-zpos-js/squash-8b31db0d-unrelated-reviews.md — backfill example"
echo ""

exit 0
