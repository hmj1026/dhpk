---
name: git-smart-commit
description: "Use when: 需要把雜亂的 git 變更拆成多個邏輯一致的 commit。Not for: 單一小變更或只需要一個 commit 的情境。Output: 可直接執行的分組提交計畫與 commit 指令。"
---

# Git Smart Commit — 智慧拆分提交

將目前所有 staged / unstaged 變更，依功能邏輯分群後，逐批 `git add` + `git commit`。

---

## When NOT to Use

- 只有單一檔案、單一目的且預期只需要 1 個 commit。
- 目前在 merge/rebase 衝突中，尚未完成衝突解決。
- 使用者要求「只生成一筆 commit」或「僅提供訊息模板」。

---

## 流程

### 1. 檢查變更狀態

執行以下指令取得完整變更清單：

```bash
git status --short
```

若沒有任何變更，告知使用者「目前沒有需要提交的變更」後結束。

接著取得所有變更的 diff 內容（用來判斷分群邏輯）：

```bash
git diff
git diff --cached
```

---

### 2. 分析並分群

根據以下維度，將檔案變更分成多個 **commit 群組**，每組代表一個獨立的邏輯單元：

#### 分群依據（優先順序）

| 優先級 | 維度 | 範例（依專案實際路徑調整） |
|--------|------|------|
| 1 | **專案設定 / 核心與 AI 規則** | 依套件管理檔（`composer.json` / `package.json` / `pyproject.toml` 等）、框架設定目錄、`.gitignore`、`CLAUDE.md`、`AGENTS.md`、根目錄 `*.md` |
| 2 | **資料表異動 (Migration)** | 專案的 migrations 目錄 |
| 3 | **領域邏輯 (Domain / Infra)** | DDD 風格時的 `domain/*` 與 `infrastructure/*`；其他架構則依專案分層 |
| 4 | **MVC 架構 (Controller/Model)** | 框架對應的 controllers / models / views 路徑 |
| 5 | **核心工具 / 共用元件** | 專案自有共用元件或內部基礎庫 |
| 6 | **前端 / Legacy JS bundle** | 主要 JS bundle（`js/*` 等）、`css/*` |
| 7 | **自動化測試** | 專案測試目錄（`tests/*` 等） |
| 8 | **文件 / 規格 (OpenSpec)** | `docs/*`、`openspec/*` |

#### 分群規則

- **領域模型與基礎設施**：同步修改的 `Domain` 與對應的 `Infrastructure` 實作應視為同一組（完整業務邏輯）。
- **MVC 功能**：同一個 Feature 的 `Controller` + `Model` + `View` 可歸為同一組。
- **資料庫遷移**：`Migration` 檔案應盡量獨立成一個 commit，方便追蹤資料庫 Schema 變更。
- **測試**：若修改某個功能，連帶修改其 `tests/*` 內的測試，應合併在同一個 commit 中。
- **其他微小變更**：若某一組只有 1 個檔案且改動極小（< 5 行），評估是否合併到最相關的鄰近組。
- **變更類型**：新增檔案用 `feat`，修改/重構用 `fix` / `refactor` / `style`，刪除或環境設定用 `chore`，文件更新用 `docs`。

---

### 3. 產出 Commit 計畫

在執行任何 git 操作之前，先列出計畫讓使用者確認：

```
📋 Commit 計畫（共 N 個 commit）

1. chore(project): 更新 AI 輔助規則
   → GEMINI.md, CLAUDE.md

2. feat(migration): 新增點數規則資料表
   → protected/migrations/m230801_120000_create_point_rule_table.php

3. feat(domain): 實作點數計算核心領域邏輯
   → domain/Point/PointCalculator.php, infrastructure/Point/PointRepository.php

4. refactor(controller): 重構儲值流程控制器
   → protected/controllers/PaymentController.php, protected/views/payment/index.php

...

確認執行？(Y/n)
```

**請暫停並等待使用者確認。**

---

### 4. 逐批執行 Commit

使用者確認後，對每一組依序執行：

```bash
git add <file1> <file2> ...
git commit -m "<type>(<scope>): <subject>"
```

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

### 5. 確認結果

所有 commit 完成後，執行：

```bash
git log --oneline -20
```

將結果展示給使用者，確認所有 commit 都已正確建立。

---

## 邊界情況處理

- **有衝突或 merge 狀態**：提醒使用者先解決衝突，不執行任何操作。
- **有敏感檔案**：提醒使用者確認是否應被 gitignore (例如 `.env` 或 config 內的機密寫死)，不自動提交。
- **變更量極大（> 50 個檔案）**：先產出大致的分組摘要，請使用者確認是否要更細緻拆分，確認後再執行。
- **使用者已有部分 staged 變更**：尊重已 staged 的狀態，將其視為一個獨立群組，或詢問使否要合併重新規劃。

---

## Output

```markdown
📋 Commit 計畫（共 N 個 commit）

1. <type>(<scope>): <subject>
   → <file1>, <file2>

...

確認執行？(Y/n)
```

- 取得確認前只輸出計畫，不執行 `git add` / `git commit`。
- 使用者確認後，提供每組可直接執行的 git 指令與預期 commit message。
- 全部完成後回報 `git log --oneline -20` 的摘要結果。

## Verification

- [ ] 已執行 `git status --short` 並確認存在變更。
- [ ] 已檢查 `git diff` 與 `git diff --cached` 完整變更內容。
- [ ] 已先輸出 commit 計畫並等待使用者確認。
- [ ] 每個 commit 群組都有明確 `type(scope): subject`。
- [ ] 提交後已檢查 `git log --oneline -20`。
