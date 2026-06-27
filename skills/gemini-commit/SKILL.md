---
name: gemini-commit
description: 'Delegate git smart commit to gemini-cli. Use when: committing changes via gemini-cli''s git-smart-commit skill (offload commit batching to Gemini). Not for: a single simple commit, or when gemini-cli is unavailable. Output: grouped commits created by gemini-cli plus a git log summary.'
allowed-tools: Bash, Read, Grep, Glob
---

# gemini-commit — 委派 gemini-cli 執行智慧拆分提交

透過 gemini-cli headless mode 調用 `.gemini/skills/git-smart-commit`，自動分群並逐批 commit。

---

## When NOT to Use

- 單一、簡單的變更（一個 commit 就夠）→ 直接用 `/smart-commit`。
- gemini-cli 未安裝或不可用。
- 有未解決的 merge conflict（先處理衝突再提交）。
- 目前沒有任何 git 變更。

---

## 流程

### 1. 前置檢查

依序執行以下檢查，任一失敗則中止：

```bash
# 檢查 gemini-cli 是否存在
command -v gemini >/dev/null 2>&1 && echo "GEMINI_OK" || echo "GEMINI_MISSING"
```

- `GEMINI_MISSING` → 回報：「gemini-cli 未安裝。安裝方式：`brew install gemini-cli` 或參考 https://github.com/google-gemini/gemini-cli」，中止。

```bash
# 檢查 git 變更
git status --short
```

- 無輸出 → 回報：「目前沒有需要提交的變更」，中止。
- 有 merge conflict 標記（`UU`、`AA`）→ 回報：「有未解決的合併衝突，請先處理」，中止。

---

### 2. 顯示變更摘要

將 `git status --short` 結果和 `git diff --stat` 展示給使用者，說明即將委派 gemini-cli 執行智慧拆分提交。

告知使用者：
- gemini-cli 會以 `-y`（yolo mode）執行，自動批准所有 git 操作
- gemini-cli 的 git-smart-commit skill 會先產出計畫、再逐批 commit
- 過程中 gemini-cli 的輸出會即時顯示
- toml prompt 已含約束，禁止 gemini 修改任何檔案（僅允許 git 操作）

---

### 3. 調用 gemini-cli

使用 headless + yolo mode 執行：

```bash
gemini -y -p "/gemini-commit"
```

**參數說明：**
- `-y`：yolo mode，自動批准所有 tool calls（git add、git commit 等寫入操作）
- `-p "/gemini-commit"`：以 headless mode 執行 `.gemini/commands/gemini-commit.toml` 定義的 prompt（SSOT）

**超時設定：** 設定 bash timeout 為 300000ms（5 分鐘），大量變更可能需要較長時間。

---

### 4. 結果回報

gemini-cli 執行完畢後：

```bash
git log --oneline -10
```

將 commit 結果展示給使用者，包含：
- 新建立的 commit 數量與內容
- 若有錯誤，顯示 gemini-cli 的錯誤輸出

---

## 錯誤處理

| 狀況 | 處理 |
|------|------|
| gemini-cli 不存在 | 告知安裝方式，中止 |
| 無 git 變更 | 告知無變更，中止 |
| 有 merge conflict | 告知先解決衝突，中止 |
| gemini-cli 執行失敗（非零退出碼）| 顯示錯誤輸出，建議使用 `/smart-commit` 作為替代方案 |
| gemini-cli 超時 | 告知超時，建議手動執行 `gemini` 進入互動模式 |

---

## Output

- gemini-cli 智慧拆分後建立的多個 commit。
- 以 `git log --oneline -10` 顯示提交結果摘要（commit 數量與內容）。
- 失敗時顯示 gemini-cli 的錯誤輸出，並建議改用 `/smart-commit`。

## Verification

- [ ] gemini-cli 存在（`command -v gemini`）。
- [ ] 有待提交的變更，且無未解決的 merge conflict。
- [ ] gemini-cli 以零退出碼結束。
- [ ] `git log --oneline -10` 確認新 commit 已建立。
