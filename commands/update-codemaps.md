---
description: '掃描程式碼結構，產生或更新 docs/CODEMAPS/ 架構文件，供 AI 快速載入專案全貌。'
allowed-tools: 'Read, Grep, Glob, Bash(ls:*), Bash(git:*), Write, Edit'
---

# Update Codemaps

Analyze the codebase structure and generate token-lean architecture documentation.

## Step 1: Scan Project Structure

1. 識別專案架構：Yii 1.1 MVC + DDD 混合架構（單體應用）
2. 掃描主要目錄：
   - `protected/controllers/` — Controller 層
   - `protected/models/` — ActiveRecord Model
   - `protected/views/` — PHP View 模板
   - `protected/commands/` — Console Command
   - `protected/components/` — Yii Component
   - `protected/controllers/traits/` — Controller Trait（含 `DomainApplicable`、`Response`）
   - `protected/helpers/` — 跨功能共用 Helper
   - `domain/` — Domain Service 層（DDD）
   - `infrastructure/` — Repository / 外部整合層（DDD）
   - `js/` — 前端 JavaScript（Raw ES6，無 build step）
3. 標示進入點：`index.php`、`protected/config/main.php`

## Step 2: Generate Codemaps

若 `docs/CODEMAPS/` 不存在，先建立目錄（`mkdir -p docs/CODEMAPS`）。

在 `docs/CODEMAPS/` 建立或更新以下文件：

| 文件 | 內容 |
|------|------|
| `architecture.md` | 高階系統圖、DDD 分層、Controller → Service → Repository 呼叫路徑 |
| `backend.md` | Controller actions、Service 方法、Repository 對應、Console Commands |
| `frontend.md` | `js/` 目錄結構、`POS.*` 全域 API、View 檔案與 JS 的關聯 |
| `data.md` | MySQL 資料表、ActiveRecord Model 對應、關聯（relations） |
| `dependencies.md` | 外部 API 整合、第三方服務、Yii extensions、Composer 套件 |

### Codemap Format

每份 codemap 應精簡 — 針對 AI context 消耗最佳化：

```markdown
# 後端架構

## Controller Actions（路由）
POST sale/checkout → SaleController::actionCheckout → $this->app()->sale->checkout() → SaleRepository->save()
GET  maintain/category → MaintainController::actionCategory → $this->app()->category->fetchAll()

## 關鍵檔案
protected/controllers/PosController.php（POS 結帳 作廢流程）
protected/models/Device.php（設備列印邏輯）

## DDD 呼叫路徑
Controller → $this->app()->{service}->method() → Repository->forXxx()
（$this->app() 定義於 protected/controllers/traits/DomainApplicable.php）

## Dependencies
- MySQL（主資料庫）
- EILogger（統一日誌系統）
```

## Step 3: Diff Detection

1. 若已有 codemaps，計算變更百分比
2. 變更 > 30%：顯示差異摘要，請使用者確認後再覆寫
3. 變更 <= 30%：直接更新

## Step 4: Add Metadata

在每份 codemap 頂部加入時效 header：

```markdown
<!-- 產生時間: 2026-04-02 | 掃描檔案數: 142 | 預估 token: ~800 -->
```

## Step 5: Save Analysis Report

若 `.reports/` 不存在，先建立目錄（`mkdir -p .reports`）。

將摘要寫入 `.reports/codemap-diff.txt`：
- 自上次掃描以來新增/刪除/修改的檔案
- 新偵測到的外部依賴
- 架構變更（新 Controller、新 Service、新 Repository 等）
- 超過 90 天未更新的文件警告

## Tips

- Focus on **high-level structure**, not implementation details
- Prefer **file paths and function signatures** over full code blocks
- Keep each codemap under **1000 tokens** for efficient context loading
- Use ASCII diagrams for data flow instead of verbose descriptions
- Run after major feature additions or refactoring sessions
- 用 `$this->app()` 追蹤 DDD 呼叫路徑（定義於 `DomainApplicable.php`）
- 前端以 `POS.*` 全域物件為核心，無 npm/webpack/babel
- 注意 `protected/` 目錄下的 Yii 慣例結構（controllers/models/views/components/commands）
