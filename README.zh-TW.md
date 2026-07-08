# dhpk — Claude Code 開發 Harness 插件套件

> **語言**: [English](./README.md) · **繁體中文**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![Version](https://img.shields.io/github/v/tag/hmj1026/dhpk?label=version&sort=semver)](https://github.com/hmj1026/dhpk/tags) [![CI](https://img.shields.io/github/actions/workflow/status/hmj1026/dhpk/ci.yml?branch=main&label=CI)](https://github.com/hmj1026/dhpk/actions/workflows/ci.yml) [![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-plugin-8A63D2)](https://docs.claude.com/en/docs/claude-code/plugins)

通用、安裝即用的 Claude Code harness。內含 **29 個角色導向 agent**（28 個 root + 1 個模組範圍的 reviewer）、約 45 個已註冊的 dhpk 指令（44 個 root 指令 + `ts-check-status` JS 模組指令；內附的 codex / gitnexus / git 樹各自另有自己的一套指令）、約 59 個核心 skill 加上跨專案的 `deploy-list` 部署清單產生器 + **`/dhpk:do` Smart Router**（透過 20 條雙語 route-table 規則 + LLM fallback 進行自然語言任務路由）+ **跨 session 學習 DB**（作業訊號儲存庫，附信心衰退機制，預設關閉）、**7-slot sentinel 驅動的 review hook**（code / db / sec / frontend / doc / **polyfill** / **migration** — polyfill 由 `library-author` 提供，migration 由模組 triggers 或 `mig:` 額外路徑啟用；`doc-reviewer` 同時涵蓋 SSOT／連結有效性與 `.md` DSL artifact 的 frontmatter schema）、statusline、harness 腳本，以及 **31 個可選用的技術棧模組**（PHP：`php-5.6`、`php-7.4`、`php-8.x`；Yii：`yii-1.1`；PHPUnit：`phpunit-5.7`、`phpunit-9`、`phpunit-10`、`phpunit-11`；Laravel：`laravel-5.4`、`laravel-6` 至 `laravel-11`；前端：`js`、`vue-2`、`laravel-mix`；Next.js：`nextjs-15.5`、`nextjs-16`；React：`react-18`、`react-19`；**Python**：`python`、`fastapi`、`pytest`；跨版本的 `library-author`；以及 **iOS/Swift 套件**（`swift`、`swiftui`、`ios-platform`、`swift-testing`、`xcode-tooling`））。模組可透過 **wrapper-dispatch** 模型在 runtime 提供 hook（詳見 [`docs/hook-extension.md`](./docs/hook-extension.md)）。內附平行的 Codex CLI 樹，適用於雙助理（Claude + Codex）專案。

> **Harness engineering 重於 prompt engineering。** dhpk 把 agent 的運作環境——hooks、sentinel review gate、路由規則、技術棧感知模組——當作施力點。你安裝的不是逐次微調的 one-off prompt，而是一套可重用的 harness，讓正確的檢查自動觸發，並讓模型跨 session 維持在軌道上。

OpenSpec 是**可選的外部整合**——若需要 OpenSpec 工作流指令，請另行安裝 [OpenSpec 插件](https://github.com/Fission-AI/OpenSpec)。dhpk 僅保留自家加值的 `opsx-apply-resume`（長時間 OpenSpec 工作階段的 context handoff）；v0.2.1 起，10 個通用 OpenSpec wrapper skill/command 已從套件中移除，由 OpenSpec 上游提供。

## 前置需求

| 工具 | 狀態 | 用途 |
|------|------|------|
| `bash` | 必要 | 所有 hook 與輔助腳本 |
| `git` | 必要 | Sentinel／artifact 路徑解析；`git rev-parse --show-toplevel` |
| `python3` | 啟用 `modules` 時為必要 | 在 `post-edit-remind` 與 `session-start` 中解析 `module.yaml` |
| `jq` | 選用（有 python3 後援） | 較快的 JSON payload 擷取 |
| `docker` | 選用 | 僅在 `userConfig.docker_containers` 非空時會被使用 |
| Codex MCP server | 選用 | 僅在你使用 5 個 MCP-backed `codex-*` skill、7 個 `/dhpk:codex-*` 指令，或啟用 `CODEX=on` 時才需要——透過將 Claude Code 指向 Codex CLI 的 `codex mcp-server` 子指令來註冊，見 [`docs/configuration.zh-TW.md`](./docs/configuration.zh-TW.md#codex-mcp-依賴並非-userconfig-旋鈕) |
| Codex CLI 執行檔 | 選用 | 僅在執行 `install-codex-skills.sh` 且希望 Codex 真正載入同步內容時才需要 |
| `cx` CLI | 選用 | 語意化程式碼導覽。`rules/tool-routing.md` 將 `cx overview` / `cx definition` / `cx references` 列為首選工具；6 個 reviewer agent 與 `harness-fill` skill 會引用。未安裝時 → 降級為 `Grep` / `Read`。 |
| `gitnexus` MCP server | 選用 | 知識圖譜查詢（`gitnexus_impact`、`gitnexus_rename`、`gitnexus_detect_changes`）。6 個 `gitnexus-*` skill 以及 `rules/execution-policy.md` 的 self-check 會用到。未安裝時 → 降級為 `cx` 或 `Grep`。 |
| `claude-mem` | 選用 | 跨 session 記憶搜尋（`mem-search`）。`rules/tool-routing.md` 用於查找過往決策。未安裝時 → 直接略過。 |

缺少選用工具會以優雅退化處理（腳本 no-op 或跳過該功能）。缺少必要工具則會在 SessionStart 或第一個 hook 觸發時以單行 `[hook-name] WARN: …` 寫到 stderr，方便你採取行動。

外部 code-navigation 工具（`cx`、`gitnexus`、`claude-mem`）**不由 dhpk 內附**，是否安裝由各 consuming 專案決定。dhpk 內附的 rules 與 agents 寫法已預設它們可能不在，會依 [`rules/tool-routing.md`](./rules/tool-routing.md) 自動降級。

## 安裝

dhpk 遵循 [Claude Code plugin 標準發布模式](https://docs.claude.com/en/docs/claude-code/plugins)。最快的路徑（不用 clone）：

```bash
claude plugin marketplace add hmj1026/dhpk
claude plugin install dhpk@dhpk --config modules=php-8.x,laravel-11 --config hook_profile=standard
```

**需求**：Claude Code 2.x。Codex MCP 為**選用**——它驅動 `codex-*` skill/指令與 `CODEX=on` 雙助理路徑；其餘一切皆 Codex-free。設定與驗證見 [`docs/configuration.zh-TW.md`](./docs/configuration.zh-TW.md#codex-mcp-依賴並非-userconfig-旋鈕)。

安裝後隨時可用 `/dhpk:setup` 重新設定（或 `/dhpk:setup --show` 印出目前生效設定）。完整安裝路徑（GitHub vs. 本地 clone）、更新／移除、疑難排解請見 **[`docs/basic-operations.zh-TW.md`](./docs/basic-operations.zh-TW.md)**。完整 `--config` 旋鈕參考見 **[`docs/configuration.zh-TW.md`](./docs/configuration.zh-TW.md)**。

## 你會得到什麼

| 元件 | 數量 | 說明 |
|------|----:|------|
| Agents | 28 root-level agents | 7 個 sentinel 驅動的 reviewer，對應各 slot：code / db / sec / **frontend** / **doc** / **polyfill**（slot 5，由 `library-author` 寫入）/ **migration**（slot 6，經模組 triggers 或 `mig:` 額外路徑 opt-in）。情境型：architect、tdd-guide、refactor-cleaner、ui-ux-verifier、performance-analyzer、doc-updater、docs-lookup、harness-reviser、version-matrix-impact-reviewer、**swift-build-resolver**（iOS 套件）、**silent-failure-hunter**（錯誤處理稽核）、**spec-miner**（brownfield→OpenSpec 萃取）、**type-design-analyzer**（型別設計）、**agent-evaluator**（產出品質評分）、**e2e-runner**（E2E 旅程）、**smoke-tester**（唯讀 live-runtime 探針）。 |
| Commands | ~45 | `dhpk:do`（Smart Router）、`dhpk:create-dev`、`dhpk:codex-*`、`dhpk:review-pending`、`dhpk:smart-commit`、`dhpk:ts-check-status`（JS 模組）、`dhpk:opsx-apply-resume`（需 OpenSpec）、`dhpk:matrix-cell-onboard`（library-author）、`dhpk:de-ai-flavor`、`dhpk:deploy-list`、`dhpk:harness-fill`、`dhpk:ui-ux-verify` 等 |
| 核心 skills | ~59 加上 | codex-*、gitnexus、tool-routing、dhpk-execution-policy、**adaptive-dev-workflow**（Feature/Bug/Maintenance 分類器）、**deploy-list**（跨專案部署清單產生器）、**execution-checklist**（任務收尾自檢）、`opsx-apply-resume` 配套（需 OpenSpec） |
| 技術棧模組 | 31 | PHP：`php-5.6`、`php-7.4`、`php-8.x` · Yii：`yii-1.1` · PHPUnit：`phpunit-5.7`、`phpunit-9`、`phpunit-10`、`phpunit-11` · Laravel：`laravel-5.4`、`laravel-6` … `laravel-11` · 前端：`js`、`vue-2`、`laravel-mix` · Next.js：`nextjs-15.5`、`nextjs-16` · React：`react-18`、`react-19` · **Python**：`python`、`fastapi`、`pytest` · `library-author` · **iOS**：`swift`、`swiftui`、`ios-platform`、`swift-testing`、`xcode-tooling`（選用；詳見下方「模組」） |
| Hooks | 9 個事件 | PreToolUse（Edit、Bash + dispatcher + sentinel-gate + branch-safety、Task\|Agent warmstart）、PostToolUse（Edit + dispatcher + async crlf-fix + async manifest-guard）、SessionStart（+ version-pin／cross-CLI-drift／broken-symlink advisory）、PreCompact（checkpoint 存檔）、PostCompact（sentinel 還原）、SubagentStop（reviewer 驗證 + 失敗記錄）、StopFailure（失敗記錄）、UserPromptSubmit（skill 提示）、Stop（review-reminder + completion-evidence + graduation-scan + reap-stale-sentinels） |
| Hook dispatchers | 2 | `post-edit-dispatch.sh`、`pre-bash-dispatch.sh` — 分派到啟用模組的 hook |
| Harness 腳本 | 5 | precommit-runner、verify-runner、harness-audit、codemap generator、dep-audit |
| Codex 雙軌 | 14 skills + 1 agent（5 個 config profile） | 由 `install-codex-skills.sh` 同步進專案的 `.codex/` |

## 常見工作流

所有功能都能透過 `/dhpk:do` 進入——一個接收自然語言任務描述、並路由到正確 skill 的單一入口：新功能開發、修 bug、自動 post-edit review 循環、提交與 PR、無人值守 OpenSpec session、萃取規格、E2E 測試撰寫、harness 健康檢測，以及 Implementation dispatch（推理密集工作 → `deep-reasoner`，機械式工作 → `fast-worker`）。每項的完整說明與範例見 **[`docs/basic-operations.zh-TW.md`](./docs/basic-operations.zh-TW.md)**。

```text
/dhpk:do implement a password-reset email flow   # 新功能（TDD + review gate）
/dhpk:do fix the login redirect loop              # 修 bug（根因證據 + 回歸測試）
/dhpk:review-pending                              # 立即觸發待處理的 reviewer
/dhpk:smart-commit && /dhpk:create-pr             # 提交 + 建 PR
/harness-audit                                    # harness 健康評分
```

---

## userConfig

40 個旋鈕，全部可在安裝時用 `--config <key>=<value>` 設定，也可隨時用 `/dhpk:setup` 重新設定。完整參考（每個旋鈕在哪裡設定、所有選項、專案層級覆寫語法）見 **[`docs/configuration.zh-TW.md`](./docs/configuration.zh-TW.md)**。

```bash
claude plugin install dhpk@dhpk \
  --config modules=php-7.4,php-8.x,laravel-6,laravel-11,phpunit-9,library-author \
  --config docker_containers=php-fpm,mysql \
  --config hook_profile=standard
```

精選的模組組合請見 `manifests/install-profiles.json`。

## Codex 支援的 skill 與指令

dhpk 的核心——hooks、sentinel reviewers、Smart Router，以及約 51 個其他 skill——皆為 Codex-free。`codex-*` 家族委派給 OpenAI 的 Codex 取得第二意見。它們的 `mcp__codex__codex` / `mcp__codex__codex-reply` 工具來自**直接註冊** Codex CLI 自身的 `codex mcp-server` 子指令為 MCP server（`claude mcp add --transport stdio codex -- codex mcp-server`）——**並非**來自安裝 `openai/codex-plugin-cc` plugin（那是另一個獨立的 Codex surface，不會註冊任何 MCP server）。完整註冊步驟與 plugin-vs-MCP-server 對照見 [`docs/configuration.zh-TW.md` 的運作原理說明](./docs/configuration.zh-TW.md#codex-mcp-依賴並非-userconfig-旋鈕)。

| Surface | 名稱 | 需要 | 缺少時 |
|---------|------|------|--------|
| 5 個 skill | `codex-architect` · `codex-brainstorm` · `codex-code-review` · `codex-explain` · `codex-implement` | Codex MCP（`mcp__codex__codex`、`mcp__codex__codex-reply`） | 工具權限錯誤——無自動 fallback；改用下方的 Codex-free 對應品 |
| 1 個 skill | `codex-cli-review` | 僅需 Codex CLI 執行檔（透過 Bash shell out——無 MCP server） | `codex: command not found`；改用 `codex-code-review`（MCP）或 sentinel `code-reviewer` |
| 7 個指令 | `/dhpk:codex-review`、`-review-branch`、`-review-doc`、`-review-fast`、`-security`、`-test-gen`、`-test-review` | Codex MCP | 工具權限錯誤——Codex-free 路徑：`/dhpk:security-review`、`/dhpk:precommit`、sentinel review hooks |
| `CODEX=on` | Implementation dispatch 的雙助理 peer 路徑 | Codex MCP | 不會壞——dispatch 維持預設的單助理模式 |

Codex-free 對應品：`security-review` ↔ `codex-security`、`code-explore` ↔ `codex-explain`、sentinel reviewer agents ↔ `codex-code-review`，以及 `create-dev`（預設 Codex-free；`--codex` 才啟用）。

一次性設定：以 `claude mcp add --transport stdio codex -- codex mcp-server` 註冊 Codex MCP server，再用 `claude mcp list` 與 `/mcp` 驗證（找到已連線的 `codex` 項目）。完整驗證步驟、MCP-vs-Skill surface 區別，以及獨立的 `openai/codex-plugin-cc` 協作 surface：**[`docs/configuration.zh-TW.md`](./docs/configuration.zh-TW.md#codex-mcp-依賴並非-userconfig-旋鈕)** / **[`docs/basic-operations.zh-TW.md`](./docs/basic-operations.zh-TW.md#10-codex-雙助理協作)**。

## 外部 code-navigation 工具

`cx`、`gitnexus`、`claude-mem` 是**可選**依賴——不由 dhpk 內附、不自動安裝。內附的 agents / skills / rules 寫法已預設它們可能不存在，並透過 [`rules/tool-routing.md`](./rules/tool-routing.md) 提供確定性的降級路徑。

| 工具 | 主要使用者（節錄） | 缺失時影響 |
|------|------------------|-----------|
| `cx` CLI | Agents：`code-reviewer`、`doc-reviewer`、`doc-updater`、`frontend-reviewer`、`migration-reviewer`、`refactor-cleaner`。Skills：`harness-fill`、`tool-routing`、`polyfill-version-matrix-audit`。Rule：`tool-routing.md`（`cx overview` / `cx definition` / `cx references` 為首選）。 | 失去 sub-200 token 的檔案概覽與 AST 等級的符號讀取——降級為 `Grep` + `Read`（耗 token 較多，精度較低）。 |
| `gitnexus` MCP | 專屬 skills：`gitnexus-cli`、`gitnexus-debugging`、`gitnexus-exploring`、`gitnexus-guide`、`gitnexus-impact-analysis`、`gitnexus-refactoring`。Agents：`architect`、`code-reviewer`、`database-reviewer`、`migration-reviewer`、`performance-analyzer`、`refactor-cleaner`、`security-reviewer`、`ui-ux-verifier`。Rules：`execution-policy.md` self-check（`gitnexus_impact`）、`tool-routing.md`。 | 失去跨檔案 blast-radius 分析（`gitnexus_impact`）、安全 global rename（`gitnexus_rename`）、pre-commit 範圍檢查（`gitnexus_detect_changes`）——降級為 `cx references` / `git diff --stat` / **find-and-replace 禁用**。 |
| `claude-mem` | Rule：`tool-routing.md` 的「Past decisions (cross-session)」入口。 | 失去跨 session 記憶搜尋；當前 session 仍可從 scrollback 取得脈絡。 |

詳細的路由判斷規則見 [`rules/tool-routing.md`](./rules/tool-routing.md)；prose 與 sub-agent 樣板版本見 `dhpk:tool-routing` skill。

## Rules（資源層）

`rules/` 內附三份 plain-markdown 資源，**不註冊於 `plugin.json`**，由 consuming 專案自行 opt-in。在專案 `CLAUDE.md` 內以 `@${CLAUDE_PLUGIN_ROOT}/rules/<file>.md` 載入。目前提供：

- `execution-policy.md` — pre-plan checklist、anti-loop、self-check gate。
- `tool-routing.md` — 上述 `cx` / `gitnexus` / `claude-mem` 決策樹。
- `anti-rationalization.md` — 防止檢查失敗時的事後合理化。
- `model-economics.md` — 成本/分級 SSOT：role→model-tier 對照表、reviewer 升級規則，以及 deep-reasoner/fast-worker 的 effort 調節。

## 模組

**模組**是有標籤、有版本號的 skill + 參考資料 + hook + trigger 貢獻組合，由 `userConfig.modules` 控管啟用。同一軸線（PHP / Laravel / PHPUnit）的模組是**加法式**的——橫跨 Laravel 6–11 的函式庫應全數啟用以取得累積指引。目前內附：

**PHP 語言基線** — 依你 composer `require.php` 約束涵蓋的版本選擇：
- **`php-5.6`** — 禁止 7.0+ 語法；提供 polyfill 指引。
- **`php-7.4`** — typed properties、arrow functions、null coalescing assignment。連線 **php-cs-fixer post-edit hook** + pre-commit lint + phpstan + psalm gate。
- **`php-8.x`** — readonly、enums、match、named args、attributes、first-class callable syntax。

**框架**：
- **`yii-1.1`** — Yii 1.1：alias autoload、`CActiveRecord` / `CDbCriteria`、`accessRules`、XSS / CSRF 預設。需要 `php-5.6`。
- **`laravel-5.4`** — Laravel 5.4（LTS，2017/02）：Blade components & slots、route model binding、middleware groups、realtime facades、markdown mailables、Elixir → Mix 轉換；5.3 → 5.4 陷阱。需要 `php-5.6`。
- **`laravel-6`** … **`laravel-11`** — 每個主版本一個模組。各版本：Eloquent / collection / cast / migration / queue / event / mail / notification / package-discovery 差異；Testbench 對照；deprecated 牆。

**測試**：
- **`phpunit-5.7`** — PHPUnit 5.7 assertion API 與用法。需要 `php-5.6`。
- **`phpunit-9`** / **`phpunit-10`** / **`phpunit-11`** — 各主版本 API 差異（`createMock` vs `createPartialMock`、attribute-based metadata、deprecation surface）。

**前端**：
- **`js`** — JS / TS 工具鏈。ESLint flat-config 分層策略（Tier 1 嚴格 / 1.5 core-exempt / 1.7 deferred-migration / globals）、per-leaf `// @ts-check` 漸進啟用、async post-edit ESLint 反饋、pre-commit `npm run <lint> + <typecheck>` gate。框架無關。
- **`vue-2`** — Vue 2（Options API 時代，`^2.5`）：`data()` / `computed` / `methods` / `watch` + 生命週期結構、props-down + `$emit` events-up、Vue 2 reactivity 陷阱（`Vue.set` / 陣列索引與長度）、`@vue/test-utils` 1.x + `vue-jest` 3 SFC 測試。早於 Composition API。
- **`laravel-mix`** — Laravel Mix 5（`^5.0.9`，webpack 4）：`webpack.mix.js` 入口/輸出對映、`mix()` versioning + manifest、`dev` / `watch` / `hot` / `prod` 腳本階梯、新版 Node 上 prod build 的 legacy-OpenSSL flag。
- **`nextjs-15.5`** — Next.js 15.5（現行穩定的 15.x 線，止於 v15.5.19；15.6 未曾發布穩定版）。App Router、`next typegen`、穩定 typed routes（`typedRoutes`）、beta Turbopack 生產建置（`next build --turbopack`）、React 18/19 雙支援，以及 `next lint` 棄用（16 移除）。
- **`nextjs-16`** — Next.js 16（現行穩定主版本，16.2.x）。Turbopack 於 dev + build 預設啟用、Request API 改為 async-only（`params`/`searchParams`/`cookies`/`headers`）、Node.js 20.9+ / TypeScript 5.1+ 下限、`next lint` 與 AMP 移除、`next/image` `priority`→`preload`、`next upgrade` CLI（16.1）。支援 React 18.2+/19（建議 React 19，但非必需）。
- **`react-18`** — React 18（2022 年 3 月）。`createRoot`/`hydrateRoot`（`react-dom/client`）、automatic batching、可選用的 concurrent features（`startTransition`/`useTransition`/`useDeferredValue`）、streaming SSR（`renderToPipeableStream`）、新 hooks（`useId`/`useSyncExternalStore`/`useInsertionEffect`），以及 StrictMode 於 dev 重複執行 effect。React 18.2+ 是 Next.js 16 支援的下限。
- **`react-19`** — React 19（2024 年 12 月）。Actions 與 async transitions、新 hooks（`useActionState`/`useOptimistic`/`useFormStatus`、`use()`）、`ref` 作為一般 prop（免 `forwardRef`）、`<Context>` 直接當 provider、document metadata 自動 hoist、資源預載（`preload`/`preinit`）、穩定的 Server Components。移除 `ReactDOM.render`/`hydrate`、function component 的 `propTypes`/`defaultProps`、legacy Context 與 string refs。Next.js 16 建議但非必需。

**跨版本**：
- **`library-author`** — 多主版本 PHP 函式庫（Laravel 6–11、Monolog 2/3、PHPUnit 8–11、Flysystem 1/3 等）的跨版本膠水。附帶**第六色** `polyfill-reviewer` agent（透過 `.pending-polyfill-review` sentinel 驅動）、`polyfill-version-matrix-audit` skill、`matrix-cell-onboard` skill（+ 根目錄 `/dhpk:matrix-cell-onboard` 別名）、OpenSpec artifact guard，以及雙測試套件映射輔助。在包含 runtime 版本 guard（`version_compare`、`class_exists`、`method_exists`、`Composer\InstalledVersions::*`）的 `.php` 編輯時自動觸發。

**iOS / Swift**（依賴鏈式——每個都 `requires: swift`；可用 `ios-app` 安裝 profile 一次啟用整套）：
- **`swift`** — Swift 6 strict-concurrency 基線 + Swift 5.10 / iOS 17 相容性 + Swift 6.2 approachable-concurrency。整套套件的基礎。
- **`swiftui`** — MVVM + Coordinator、Observation（`@Observable` / `@Bindable`）、`NavigationStack` 路由、Combine / UIKit 互通。需要 `swift`。
- **`ios-platform`** — health/PHI iOS SDK：Core Data 加密、CryptoKit + Keychain、actor 離線儲存、Vision OCR、LocalAuthentication、UserNotifications、HealthKit、隱私合規。需要 `swift`。
- **`swift-testing`** — XCTest + Swift Testing、XCUITest、snapshot 測試、3 層測試分類、protocol-DI host testing。需要 `swift`。
- **`xcode-tooling`** — SwiftLint post-edit hook + xcodebuild/SPM pre-commit build+test gate（generic build destination、模擬器自動回退、工具鏈不存在時自動跳過）+ `ios-icon-gen` skill。需要 `swift`。

啟用後，模組會：
- 將其 skill 以 `dhpk:<skill-name>` 形式暴露（例如 `dhpk:php-pro`、`dhpk:yii1-security-audit`、`dhpk:js-lint-config`）。
- 為 `post-edit-remind` 貢獻路徑觸發規則，讓 reviewer 在框架特定路徑上觸發。
- 可在 `modules/<m>/hooks/post-edit-*.sh` 與 `modules/<m>/hooks/pre-{bash,commit}-*.sh` 提供 hook，模組啟用時由 dispatcher 分派執行。詳見 [`docs/hook-extension.md`](./docs/hook-extension.md)。
- 在 SessionStart 印出一行模組啟用訊息，讓 Claude 知道該模組已生效。

### 新增模組

```bash
mkdir -p modules/<stack>-<version>/{skills,references}
cat > modules/<stack>-<version>/module.yaml <<'EOF'
name: <stack>-<version>
display_name: "..."
version: 0.1.0
description: "..."
requires: []
triggers:
  code: { extensions: [], paths: [] }
  db:   { extensions: [], paths: [] }
  sec:  { extensions: [], paths: [] }
provides:
  skills: []
EOF
```

至少新增一個 `modules/<stack>-<version>/skills/<name>/SKILL.md`。接著在 `.claude-plugin/plugin.json` 註冊路徑：

```json
"skills": [..., "./modules/<stack>-<version>/skills/"]
```

在 manifest 中 bump 插件 `version`。執行 `claude plugin validate ~/projects/dhpk --strict`。並在本 README 中說明新模組。

每模組獨立的 hook 自 v0.2.0 起透過 wrapper-dispatch 模型支援。把腳本放在 `modules/<stack>-<version>/hooks/`：

- `post-edit-*.sh` — 由 `scripts/hooks/post-edit-dispatch.sh` 在模組啟用時（背景）執行。
- `pre-bash-*.sh` / `pre-commit-*.sh` — 由 `scripts/hooks/pre-bash-dispatch.sh` 同步執行（可阻擋）。

Dispatcher 契約與 `js` 模組的完整範例詳見 [`docs/hook-extension.md`](./docs/hook-extension.md)。

### 模組參考資料中的外部路徑佔位符

模組 `references/*.md` 可能包含專案特定的路徑佔位符：

- `<framework-source>` — 框架原始碼本機 checkout（例如 Yii framework）。
- `<project-root>` — 你的專案根目錄。
- `<container-workdir>` — docker container 內的 `-w` 工作目錄。
- `<docker-bind-mount>` — bind-mount 進 container 的主機路徑。

當你在專案筆記中引用模組內容時，請替換掉這些佔位符。

## 接上 statusline

插件規格本身沒有 statusline 元件，請在專案的 `.claude/settings.json` 中手動加入：

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/statusline/statusline.sh"
  }
}
```

Statusline 會渲染 `[branch] +staged ~modified | docker:status | profile=<p> | mod=<active> | ⚠ <pending-sentinels>`，並退回到全域 `~/.claude/statusline.sh` 取得 token/模型/rate-limit 行。

## 同步 Codex CLI 內容

適用於同時使用 Claude Code 與獨立 Codex CLI 的專案（與上方的 Codex MCP 依賴是兩回事——這條路徑不需要任何 MCP server）：`bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"` 會把 dhpk 的 skill/agent 鏡射進專案的 `.codex/`，另有實驗性的 Codex Plugin Marketplace 安裝路徑。完整說明見 **[`docs/basic-operations.zh-TW.md`](./docs/basic-operations.zh-TW.md#同步-codex-cli-內容)**。

## 遷移現有專案

若專案已有自己的 `.claude/` harness，dhpk 支援分階段的並行安裝 → hook 對齊 → 切換流程，每階段都有 rollback gate。完整 6 階段步驟見 **[`docs/basic-operations.zh-TW.md`](./docs/basic-operations.zh-TW.md#遷移現有專案)**。

## 儲存庫結構

```
dhpk/
├── .claude-plugin/
│   ├── marketplace.json          # 單一條目的 marketplace（plugins[0].source: "./"）
│   └── plugin.json               # 含 userConfig 的插件 manifest
├── agents/                       # 29 個角色 agent（28 root + 1 模組 reviewer；INDEX.md 為導覽用）
├── commands/                     # ~45 個 slash 指令（do、create-dev、codex-*、smart-commit、opsx-apply-resume、matrix-cell-onboard 等）
├── skills/                       # ~59 個核心 skill（adaptive-dev-workflow、codex-*、tool-routing、dhpk-execution-policy、opsx-apply-resume 配套等）
├── templates/                    # hook 引導用範本（graduation-candidates.md — 首次 graduation 執行時複製到 .claude/artifacts/）
├── modules/                      # 31 個可選用的技術棧模組
│   ├── php-5.6/, php-7.4/, php-8.x/        # {module.yaml, skills/, references/, hooks/（僅 php-7.4）}
│   ├── yii-1.1/                            # Yii 1.1 框架
│   ├── phpunit-5.7/, phpunit-9/, phpunit-10/, phpunit-11/
│   ├── laravel-5.4/, laravel-6/ … laravel-11/  # 每個主版本一個（5.4 需要 php-5.6）
│   ├── js/{module.yaml, hooks/, skills/, commands/, references/}
│   ├── vue-2/, laravel-mix/                # 前端：Vue 2 SFC + Laravel Mix 5 資產管線
│   ├── nextjs-15.5/, nextjs-16/         # Next.js React 框架
│   ├── react-18/, react-19/             # React 函式庫（各主版本）
│   ├── library-author/{module.yaml, agents/, skills/, hooks/, references/}
│   └── swift/, swiftui/, ios-platform/, swift-testing/, xcode-tooling/  # iOS/Swift 套件（xcode-tooling 另含 hooks/ 與 skill 腳本）
├── hooks/hooks.json              # PreToolUse / PostToolUse / SessionStart / Stop 連線設定
├── scripts/
│   ├── hooks/                    # 核心 hook，含 post-edit-dispatch.sh、pre-bash-dispatch.sh、reap-stale-sentinels.sh、_lib/{payload,portable-sed,portable-timeout}.sh
│   ├── statusline/statusline.sh
│   ├── codemaps/、lib/、opsx-apply-resume/、validate/
│   └── （harness-audit、precommit-runner、verify-runner、gemini-adapt-agents、dep-audit）
├── docs/
│   ├── configuration.md、configuration.zh-TW.md      # 完整 userConfig 參考
│   ├── basic-operations.md、basic-operations.zh-TW.md # 安裝與工作流生命週期
│   ├── hook-extension.md         # wrapper-dispatch 契約 + 模組 hook 撰寫指南
│   ├── recommended-permissions.md
│   ├── docker-setup.md、subagent-prompt-template.md
├── codex/                        # Codex CLI 雙軌（Claude Code 不會自動載入）
│   ├── AGENTS.md                 # Codex 專屬指引
│   ├── README.md                 # 如何同步進專案
│   ├── skills/、agents/、config.toml.example
├── .codex-plugin/plugin.json     # Codex plugin manifest（marketplace 可安裝，實驗性）
├── plugins/dhpk/                 # 精簡 marketplace-target wrapper（openai/codex#26037）
│   ├── .codex-plugin/plugin.json
│   ├── README.md
├── .agents/plugins/marketplace.json  # repo-scoped Codex marketplace descriptor
├── manifests/install-profiles.json  # 精選模組組合
├── docs/design/bootstrap-dhpk-plugin/  # 原始設計檔案（proposal/design/tasks/specs）
├── README.md、README.zh-TW.md、CHANGELOG.md、LICENSE、.gitignore
```

## 開發

要迭代插件原始碼本身（不走 install/reinstall 迴圈），用 `--plugin-dir` 直接載入 working tree：

```bash
git clone https://github.com/hmj1026/dhpk ~/projects/dhpk
claude --plugin-dir ~/projects/dhpk
```

對插件檔案的編輯，需要 `/reload-plugins` 後才會生效（hook、MCP、LSP），或重啟 session（monitor、skill 列表）。

Marketplace 安裝路徑（`claude plugin install`）會把插件複製到 `~/.claude/plugins/cache/`，所以對原始 repo 的編輯在那裡不會生效，必須 `claude plugin update dhpk` 才會更新。

## 授權

採用 [MIT License](./LICENSE) 釋出。Copyright (c) 2026 Paul.

發布歷史見 [CHANGELOG.md](./CHANGELOG.md)。
