---
description: '審查 .pending-review sentinel 中的檔案（或指定路徑），完成後 code-reviewer 自動清除 sentinel'
argument-hint: '"[--files \"<rel-path,...>\"]"'
allowed-tools: 'Read, Bash(git:*)'
---

## Context

- Pending review files: !`cat .claude/artifacts/sessions/.pending-review 2>/dev/null || echo "(none)"`
- Git status: !`git status -sb`
- Changed files: !`git diff --stat HEAD 2>/dev/null | tail -20`

## Task

### Step 1 — 確認審查範圍

優先順序如下（取第一個有效來源）：

| 優先順序 | 條件 | 審查範圍 |
|----------|------|----------|
| 1 | 有 `--files "<paths>"` 參數 | 參數指定的路徑 |
| 2 | `.pending-review` sentinel 非空 | sentinel 中每一行的檔案路徑 |
| 3 | 以上皆無 | `git diff HEAD --name-only` 的修改清單 |

若三者皆無（nothing to review）→ 直接回報「無待審檔案」，不啟動 agent。

### Step 2 — 啟動 code-reviewer

將確認好的檔案清單與 context 傳給 `code-reviewer` agent 執行審查。

Agent prompt 應包含：
- 待審檔案清單（含相對路徑）
- sentinel 中記錄的異動時間戳（如有）
- 當前 git diff --stat（讓 agent 了解變更規模）

### Step 3 — 轉達結果

直接輸出 `code-reviewer` 的審查報告。  
Sentinel 清除由 runtime hook `subagent-stop-verify.sh` 負責（sanctioned path）：當 `code-reviewer` subagent 成功結束且產出帶可解析 `verdict:` 的審查 artifact 時，該 hook 會自動清除 `.pending-review`（非此 command、也非 reviewer 自身負責）。若審查後 sentinel 仍殘留（stale），orchestrator 可用完整 basename 手動補清：

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh" .pending-review manual
```

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
