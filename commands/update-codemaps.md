---
description: '掃描程式碼結構，產生或更新 docs/CODEMAPS/ 架構文件，供 AI 快速載入專案全貌。'
allowed-tools: 'Read, Grep, Glob, Bash(ls:*), Bash(git:*), Write, Edit'
---

# Update Codemaps

Analyze the codebase structure and generate token-lean architecture documentation.

## Step 1: Scan Project Structure

1. 偵測專案架構（框架、是否分層、是否單體 / monorepo）。常見模式：
   - 單體 MVC（Yii / Laravel / Rails / Django 等）
   - 分層 DDD（Domain / Application / Infrastructure）
   - Modular monolith / monorepo（每個模組獨立目錄）
   - Frontend SPA + Backend API
2. 掃描主要目錄。下列為**典型框架/分層**慣例路徑，依專案實際結構增刪：
   - `<controllers-dir>` — Controller 層（HTTP 入口）
   - `<models-dir>` — Domain Model / ORM Entity
   - `<views-dir>` — View / Template
   - `<commands-dir>` — Console / Worker 命令
   - `<services-dir>` — Application / Domain Service
   - `<repositories-dir>` — Repository / Data Access
   - `<frontend-dir>` — 前端 JS/CSS（含或不含 build step）
3. 標示進入點：例如 `index.php`、`public/index.php`、`src/main.ts`、`manage.py`、`config/application.rb` 等專案實際的入口檔。

## Step 2: Generate Codemaps

若 `docs/CODEMAPS/` 不存在，先建立目錄（`mkdir -p docs/CODEMAPS`）。

在 `docs/CODEMAPS/` 建立或更新以下文件：

| 文件 | 內容 |
|------|------|
| `architecture.md` | 高階系統圖、分層結構、Controller → Service → Repository（或專案實際呼叫鏈）路徑 |
| `backend.md` | Controller actions、Service 方法、Repository 對應、Console / Worker commands |
| `frontend.md` | 前端目錄結構、全域 API / namespace、View 與 JS 的關聯 |
| `data.md` | 主要資料表、ORM model 對應、關聯（relations / associations） |
| `dependencies.md` | 外部 API 整合、第三方服務、framework extensions、套件管理檔依賴 |

### Codemap Format

每份 codemap 應精簡 — 針對 AI context 消耗最佳化：

```markdown
# 後端架構

## Controller Actions（路由）
POST checkout       → CheckoutController::actionCreate → $services->checkout->process() → CheckoutRepository->save()
GET  catalog/list   → CatalogController::actionList   → $services->catalog->fetchAll()

## 關鍵檔案
<controllers-dir>/CheckoutController.php（結帳 / 退款流程入口）
<models-dir>/Order.php（訂單列印與狀態流轉）

## 呼叫路徑
Controller → <service-locator>->{service}->method() → Repository->forXxx()
（<service-locator> 在本專案的定義位置：<file-where-defined>）

## Dependencies
- <primary-database>（主資料庫）
- <project-logger>（結構化日誌）
```

> 上表示意值——把所有 `<placeholder>` 換成你專案實際的名字（class / 目錄 / 服務）後，這份 codemap 才會真的有用。

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
- 若專案有 service-locator pattern（如 `$this->app()->{service}`），先記錄其定義位置作為 codemap 入口
- 前端若用全域命名空間（如 `MyApp.*`），列出主要 namespace 與所在檔案
- 若框架有強慣例（Yii `protected/`、Rails `app/`、Django app modules），先標註慣例路徑再列專案自有結構
