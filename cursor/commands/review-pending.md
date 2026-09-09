---
name: review-pending
description: "審查指定路徑（或未指定時的目前 git diff），交由 code-reviewer 執行"
---
## Context

- Git status: !`git status -sb`
- Changed files: !`git diff --stat HEAD 2>/dev/null | tail -20`

## Task

### Step 1 — 確認審查範圍

優先順序如下（取第一個有效來源）：

| 優先順序 | 條件 | 審查範圍 |
|----------|------|----------|
| 1 | 有 `--files "<paths>"` 參數 | 參數指定的路徑 |
| 2 | 以上皆無 | `git diff HEAD --name-only` 的修改清單 |

若兩者皆無（nothing to review）→ 直接回報「無待審檔案」，不啟動 agent。

### Step 2 — 啟動 code-reviewer

將確認好的檔案清單與 context 傳給 `code-reviewer` agent 執行審查。

Agent prompt 應包含：
- 待審檔案清單（含相對路徑）
- 當前 git diff --stat（讓 agent 了解變更規模）

### Step 3 — 轉達結果

直接輸出 `code-reviewer` 的審查報告。

## Output

轉達 code-reviewer 的輸出（格式由 agent 定義）：

```
## Code Review
PASS/WARN/FIX: <items>
Verdict: APPROVE | WARNING | BLOCK
```

APPROVE = 無 CRITICAL/HIGH；WARNING = 有 HIGH；BLOCK = 有任何 CRITICAL。

## Examples

```
/review-pending
/review-pending --files "src/models/Order.php,src/services/OrderService.php"
```
