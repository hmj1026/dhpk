---
name: agy-commit
description: 'Delegate git smart commit to agy-cli. Use when: committing changes via agy-cli''s git-smart-commit skill (offload commit batching to Antigravity). Not for: a single simple commit, or when agy-cli is unavailable. Output: grouped commits created by agy-cli plus a git log summary.'
allowed-tools: Bash, Read, Grep, Glob
---

# agy-commit — 委派 agy-cli 執行智慧拆分提交

透過 agy-cli non-interactive 模式委派智慧拆分提交，自動分群並逐批 commit。

---

## When NOT to Use

- 單一、簡單的變更（一個 commit 就夠）→ 直接用 `/smart-commit`。
- agy-cli 未安裝或不可用。
- 有未解決的 merge conflict（先處理衝突再提交）。
- 目前沒有任何 git 變更。

---

## 流程

### 1. 前置檢查

依序執行以下檢查，任一失敗則中止：

```bash
# 檢查 agy-cli 是否存在
command -v agy >/dev/null 2>&1 && echo "AGY_OK" || echo "AGY_MISSING"
```

- `AGY_MISSING` → 回報：「agy-cli 未安裝。安裝與設定請參考 https://antigravity.google/docs/cli/reference」，中止。

```bash
# 檢查 git 變更
git status --short
```

- 無輸出 → 回報：「目前沒有需要提交的變更」，中止。
- 有 merge conflict 標記（`UU`、`AA`）→ 回報：「有未解決的合併衝突，請先處理」，中止。

---

### 2. 顯示變更摘要

將 `git status --short` 結果和 `git diff --stat` 展示給使用者，說明即將委派 agy-cli 執行智慧拆分提交。

告知使用者：
- agy-cli 會以 `--dangerously-skip-permissions` 自動批准權限，並用 `--add-dir "$(pwd)"` 將範圍限定在目前 repo
- agy-cli 會先產出計畫、再逐批 commit
- 過程中 agy-cli 的輸出會即時顯示
- prompt 已含約束，禁止 agy 修改任何檔案（僅允許 git 操作）

---

### 3. 調用 agy-cli

使用 non-interactive 模式執行，自動批准權限並將工作範圍限定在目前 repo：

```bash
agy --dangerously-skip-permissions --add-dir "$(pwd)" -p "Group the current git changes into cohesive, conventional-commit batches and commit each batch. ONLY run git commands (git add / git commit); do NOT edit, create, or delete any files."
```

**參數說明：**
- `--dangerously-skip-permissions`：自動批准所有 tool 權限請求，跳過 `確認執行？(Y/n)` 提示。這是 non-interactive 執行的必要條件（`AGY_ALWAYS_APPROVE` 環境變數無法跳過此確認）。
- `--add-dir "$(pwd)"`：將目前 repo 加入 workspace。**必要** —— `agy -p` 不以 shell cwd 為準；未指定時會落到 agy 快取的預設專案，可能對錯誤的 repo 提交。
- `-p "<prompt>"` (或 `--print`)：non-interactive 模式，執行 prompt 後退出。
- prompt 內含 `ONLY run git commands; do NOT edit any files` 約束，將 agy 行為限制在 git 操作。

**超時設定：** 設定 bash timeout 為 300000ms（5 分鐘），大量變更可能需要較長時間。

---

### 4. 結果回報

agy-cli 執行完畢後：

```bash
git log --oneline -10
```

將 commit 結果展示給使用者，包含：
- 新建立的 commit 數量與內容
- 若有錯誤，顯示 agy-cli 的錯誤輸出

---

## 錯誤處理

| 狀況 | 處理 |
|------|------|
| agy-cli 不存在 | 告知安裝與設定方式，中止 |
| 無 git 變更 | 告知無變更，中止 |
| 有 merge conflict | 告知先解決衝突，中止 |
| agy-cli 執行失敗（非零退出碼）| 顯示錯誤輸出，建議使用 `/smart-commit` 作為替代方案 |
| agy-cli 超時 | 告知超時，建議手動執行 `agy` 進入互動模式 |

---

## Output

- agy-cli 智慧拆分後建立的多個 commit。
- 以 `git log --oneline -10` 顯示提交結果摘要（commit 數量與內容）。
- 失敗時顯示 agy-cli 的錯誤輸出，並建議改用 `/smart-commit`。

## Verification

- [ ] agy-cli 存在（`command -v agy`）。
- [ ] 有待提交的變更，且無未解決的 merge conflict。
- [ ] agy-cli 以零退出碼結束。
- [ ] `git log --oneline -10` 確認新 commit 已建立。
