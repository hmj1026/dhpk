---
name: git-smart-commit
description: "將雜亂的 git 變更依邏輯分群、逐批提交,適用於需要把多項變更拆成多個邏輯一致 commit 的情境。Not for: 單一小變更或只需要一個 commit（直接 commit 即可）。Output: 可直接執行的分組提交計畫與 commit 指令。"
metadata:
  dhpk-invocation-class: "explicit-only"
---

# Git Smart Commit — 智慧拆分提交

將目前所有 staged / unstaged 變更，依功能邏輯分群後，逐批 `git add` + `git commit`。

## When NOT to Use

- 只有單一檔案、單一目的且預期只需要 1 個 commit。
- 目前在 merge/rebase 衝突中，尚未完成衝突解決。
- 使用者要求「只生成一筆 commit」或「僅提供訊息模板」。

## Public options and execution guard

`--scope <path>` limits collection; `--type <type>` forces the reviewed conventional type; `--ai-co-author` opts into the approved trailer. Before proposing or running commits, read `rules/execution-policy.md`, preserve its manual/automatic boundary, require code precommit success, and treat plans as unexecuted.

## 流程 — SSOT: `rules/execution-policy.md` owns commit/review safety; this skill owns grouping evidence

### 1. 收集摘要並閱讀相關變更

從 consumer 專案根目錄或子目錄執行唯讀收集器：

```bash
node "$SKILL_DIR/scripts/collect-changes.js" [--scope <path>]
```

`$SKILL_DIR` 是已安裝技能目錄。收集器原始碼見 [`scripts/collect-changes.js`](scripts/collect-changes.js)。`--scope` 是 repo-relative literal path；它限制檔案清單，但仍會回報範圍外的 staged 內容。收集器只讀取 Git 狀態與統計，不輸出 diff 或檔案內容，也不執行 hooks。

摘要提供 `repoRoot`、起始 `head`、`files`、`safety` 與 `hooks`；hook 資訊不代表已執行或通過。解讀欄位或處理收集失敗時，閱讀 [collector contract](references/collector.md)。

若收集器不存在、退出非零、JSON 無效或輸出不完整，回報摘要未完成並停止提交流程，不推斷「沒有變更」或「沒有 hook」。若 `files` 沒有範圍內變更，先檢查 `safety`，尤其範圍外 staged；確認沒有待處理安全狀態後，再回報目前範圍無需提交。

摘要只用來選出待檢查的功能群。將 shell 工作目錄切換到輸出中的 `repoRoot`，再逐路徑閱讀該群的 staged 與 unstaged diff；新增的未追蹤檔案要閱讀檔案內容。使用 literal pathspec，rename 要同時檢查新舊路徑：

```bash
git --literal-pathspecs diff -- <path>
git --literal-pathspecs diff --cached -- <path>
```

逐組檢查並控制輸出量，不先讀取整個 worktree 的完整 diff。收集器會拒絕前後觀察到的 HEAD、status 或行數統計變動，但摘要不是原子快照，也不能證明內容未變。若來源在檢查期間改變，重新收集摘要、檢查受影響內容並重擬計畫；提交前仍須核對實際 staged diff。

### 2. 分析並分群

依變更意圖、功能關聯和依賴關係分組。目錄可協助定位，不能單獨決定 commit 邊界；同一功能跨 Controller、Service、Model、View、測試或文件時，應一起評估。

#### 分群規則

- 同一功能的 Domain 與 Infrastructure 實作，以及對應測試，通常放在同一組。
- MVC 功能可將相關的 `Controller`、`Model`、`View` 和測試放在同一組。
- Migration 僅在能獨立理解和驗證時拆成單獨 commit；必要的程式相依不得拆散。
- 少量變更依實際關聯併入最相關的功能群，不以檔案數量或路徑強行合併。
- 新增功能使用 `feat`；修正或重構使用 `fix` / `refactor` / `style`；刪除或環境設定使用 `chore`；文件更新使用 `docs`。

---

### 3. 產出 Commit 計畫

在任何 index 或 commit 寫入前，列出各組的 commit message、完整路徑（rename 包含來源與目的路徑），並說明 staged／unstaged 的分組方式。唯讀 Git 查詢可在計畫前執行。

```
Commit 計畫（共 N 個 commit）

1. chore(project): 更新 AI 輔助規則
   → GEMINI.md, CLAUDE.md

2. feat(migration): 新增點數規則資料表
   → protected/migrations/m230801_120000_create_point_rule_table.php

3. feat(domain): 實作點數計算核心領域邏輯
   → domain/Point/PointCalculator.php, infrastructure/Point/PointRepository.php

4. refactor(controller): 重構儲值流程控制器
   → protected/controllers/PaymentController.php, protected/views/payment/index.php

...

授權狀態：依既有明確授權執行；若尚未授權，先等待使用者確認。
```

遵守 `rules/execution-policy.md` 的授權邊界。若目前任務已明確授權這些範圍與分組，依該授權執行，不重複要求確認；新增分組或超出授權範圍時，先取得對該變更的實際授權。

---

### 4. 逐批執行 Commit

先處理摘要中的安全狀態：

- `hasConflicts: true` 或 `operations` 非空時，停止提交並請使用者先完成相應操作。
- 有既有 staged、partial staging 或範圍外 staged 時，保留 index 和 worktree。逐層檢視 staged／unstaged 內容；不以整檔 `git add` 改寫既有選擇。若 index 尚未精確對應一個已檢查且已授權的群組，提供人工 staging 方案並停止，待使用者完成後重新收集。
- Index 原本為空時，只在該路徑的所有變更都屬於同一群組時整檔 staging。若同一路徑跨多組，提供逐 hunk 的人工 staging 方案。

每次 commit 前檢查 staged diff，確認 index 只含目前群組；rename 要核對來源與目的路徑。若內容或路徑不符，停止並重新規劃。保留正常 Git hooks；hook 失敗時停止並回報，不繞過或自動回滾。任何 code precommit 或 hook 完成後，若 HEAD、index 或 worktree 有變動，重新收集並檢查受影響差異；若計畫範圍或分組改變，先更新計畫並取得尚未授權部分的明確授權。

只有原本為空的 index 流程才使用 `git add`。若既有 index 已精確對應一個檢查且授權的群組，略過 staging，直接核對後提交。

```bash
git --literal-pathspecs add -- <reviewed-paths>
git diff --cached --name-status -z
git --literal-pathspecs diff --cached -- <reviewed-paths>
git commit -m "<type>(<scope>): <subject>"
```

依下方 Commit Message 格式產生訊息。路徑需按 shell 規則引用，並保留 Git 路徑的原始拼寫。

#### Commit Message 格式

```
<type>(<scope>): <簡短描述，繁體中文>
```

**type 對照表：**

| type | 使用時機 |
|------|---------|
| `feat` | 新增功能、API 或頁面 |
| `fix` | 修復 bug 或異常處理 |
| `style` | 純程式碼格式或樣式調整（不影響邏輯） |
| `refactor` | 程式碼重構（不改變行為） |
| `chore` | 雜務（設定檔、相依套件更新等） |
| `docs` | 文件或註解更新 (如 `openspec/*`) |
| `test` | 新增或修改測試 |

**scope 規則（建議）：**
- `domain`：領域層業務邏輯
- `infra`：基礎設施或資料儲存實作
- `model`：ActiveRecord 模型
- `controller`：控制器與路由
- `view`：視圖檔與介面
- `frontend`：前端 JS/CSS (Legacy POS)
- `migration`：資料庫異動
- `config`：系統設定與全域配置
- `spec`：OpenSpec 規格與設計文件
- 元件或功能名稱：如果變更落在特定元件或模組（例如 `<core-lib>`、`<billing>` 等專案內部命名）也可以直接寫模組名稱。

**subject 規則：**
- 使用繁體中文
- 不超過 100 字
- 不以句號結尾
- 用「動詞開頭」：新增、調整、修正、移除、重構
- 簡短描述各別檔案的變更

---

### 5. 核對結果

記錄收集器起始的 `head`。完成後檢查起始 HEAD 之後建立的 commit，逐筆核對其實際變更路徑與核准分組；起始 HEAD 為 `null` 時，逐筆核對本次建立的所有 commit（包含 root commit）。重新執行收集器，確認剩餘變更都能對應計畫中的保留項目。只列出 `git log --oneline -20` 不足以證明分組正確。

## 邊界情況處理

- **有衝突或 merge 狀態**：提醒使用者先解決衝突，不執行任何操作。
- **有敏感檔案**：提醒使用者確認是否應被 gitignore (例如 `.env` 或 config 內的機密寫死)，不自動提交。
- **變更量大**：先整理功能群摘要，再逐組檢查；沿用既有授權，只有未解決的分組選擇或新增範圍需要使用者決定。
- **已有 staged 變更**：保留使用者的 index 狀態；先檢查 staged 與 unstaged 內容，再提供可核對的分組或人工 staging 方案。

---

## Output

```markdown
Commit 計畫（共 N 個 commit）

1. <type>(<scope>): <subject>
   → <file1>, <file2>

...

授權狀態：依既有明確授權執行；若尚未授權，先等待使用者確認。
```

- 尚未取得本計畫所需授權前，只讀取狀態、diff 和檔案內容；不執行 `git add` / `git commit`。
- 授權後依序提供或執行各組指令，保留正常 hooks，hook 失敗即停止。
- 全部完成後回報起始 HEAD 之後的 commit、每筆實際路徑，以及收集器所列的剩餘變更。

## Verification

- [ ] 收集器成功輸出完整摘要，並檢查相關 staged／unstaged diff 與新增檔案內容。
- [ ] 已辨識衝突、操作中狀態、既有 staged、partial staging 和範圍外 staged。
- [ ] 計畫已符合既有授權；未授權的新分組已取得實際授權。
- [ ] 每個 commit 前都已核對 index 與已授權分組一致。
- [ ] 每個 commit 群組都有明確 `type(scope): subject`。
- [ ] 已按起始 HEAD 核對新 commit 路徑，並重新收集及核對剩餘變更。
