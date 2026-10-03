#!/usr/bin/env bash
# check-unrelated-changes.sh — advisory PR description scanner
#
# Usage:
#   bash skills/change-verdict/scripts/check-unrelated-changes.sh <pr-number> [--merge-method squash|merge|rebase]
#
# Behavior:
#   1. Require explicit merge metadata from the caller (or DHPK_PR_MERGE_METHOD)
#   2. 若是 squash + PR description 缺 `## Unrelated Changes` 段 → stdout 印 warning + 列疑似 unrelated 檔案集合
#   3. Skip only when explicit metadata says merge/rebase
#   4. 退出碼永遠 0（advisory only，不阻擋 merge）
#
# Source: project OpenSpec capability spec for squash-merge-hygiene
#         Requirement: "change-verdict PR mode MUST provide an automated unrelated-changes scanner"

set -uo pipefail

# ---- Step 1: require explicit merge metadata -----------------------------
#
# A commit subject, current HEAD, or commit count cannot establish how a PR
# will be merged. The caller must pass --merge-method (or set the environment
# variable from trusted PR metadata). Missing metadata is deliberately
# inconclusive and therefore runs the advisory scan instead of skipping it.

PR_NUMBER=""
MERGE_METHOD="${DHPK_PR_MERGE_METHOD:-}"
while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --merge-method)
            MERGE_METHOD="${2:-}"
            shift 2
            ;;
        --pr-number)
            PR_NUMBER="${2:-}"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 <pr-number> [--merge-method squash|merge|rebase]"
            exit 0
            ;;
        --*)
            echo "[error] unknown option: $1"
            exit 0
            ;;
        *)
            if [[ -z "$PR_NUMBER" ]]; then
                PR_NUMBER="$1"
            else
                echo "[error] unexpected argument: $1"
                exit 0
            fi
            shift
            ;;
    esac
done

if [[ -z "$PR_NUMBER" ]]; then
    echo "[error] Usage: $0 <pr-number> [--merge-method squash|merge|rebase]"
    echo "        Supply explicit merge metadata; missing metadata is inconclusive."
    exit 0   # advisory: 不阻擋
fi

case "$MERGE_METHOD" in
    merge|rebase)
        echo "[skip] merge method '$MERGE_METHOD' supplied explicitly; unrelated-changes check is squash-only"
        exit 0
        ;;
    squash)
        echo "[info] merge method 'squash' supplied explicitly; running unrelated-changes check"
        ;;
    "")
        echo "[info] merge method not provided; running an inconclusive advisory scan (no skip inferred from HEAD)"
        ;;
    *)
        echo "[info] merge method '$MERGE_METHOD' is not recognized; running an inconclusive advisory scan"
        ;;
esac

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
echo "    Per the project's squash-merge-hygiene capability spec,"
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
echo "      · docs/refactor-<area>/squash-<sha>-unrelated-reviews.md — backfill example"
echo ""

exit 0
