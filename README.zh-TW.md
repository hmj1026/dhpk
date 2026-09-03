# dhpk — Claude Code 開發 Harness 插件套件

> **語言**: [English](./README.md) · **繁體中文**
>
> Skill platform 升級指南：[English](./docs/skill-platform-migration.md) · [繁體中文](./docs/skill-platform-migration.zh-TW.md)
>
> 平台安裝 SSOT：[English](./docs/platform-installation.md) · [繁體中文](./docs/platform-installation.zh-TW.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![Version](https://img.shields.io/github/v/tag/hmj1026/dhpk?label=version&sort=semver)](https://github.com/hmj1026/dhpk/tags) [![CI](https://img.shields.io/github/actions/workflow/status/hmj1026/dhpk/ci.yml?branch=main&label=CI)](https://github.com/hmj1026/dhpk/actions/workflows/ci.yml) [![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-plugin-8A63D2)](https://docs.claude.com/en/docs/claude-code/plugins) [![Codex project sync](https://img.shields.io/badge/Codex%20project%20sync-supported-412991)](./docs/platform-installation.zh-TW.md#codex-project-local-syncsupported) [![Cursor project sync](https://img.shields.io/badge/Cursor%20project%20sync-supported-F2A900)](./docs/platform-installation.zh-TW.md#cursor-project-local-syncsupported) [![Native packages](https://img.shields.io/badge/native%20packages-experimental-orange)](./docs/platform-installation.zh-TW.md#surface-matrix)

通用、安裝即用的 Claude Code harness。內含 **36 個角色導向 agent**（35 個 root-level agent 加 1 個模組範圍 reviewer）、已註冊的 dhpk 指令、六個 task-shaped capability family、跨 session 學習 DB（預設關閉）、**7-slot sentinel 驅動的 review hook**（code / db / sec / frontend / doc / polyfill / migration）、statusline、harness 腳本，以及 **31 個可選技術棧模組**，涵蓋 PHP、Yii、PHPUnit、Laravel、JavaScript、Vue、Laravel Mix、Next.js、React、Python 與 iOS/Swift。模組可透過 **wrapper-dispatch** 模型在 runtime 提供 hook（詳見 [`docs/hook-extension.zh-TW.md`](./docs/hook-extension.zh-TW.md)）。內附策展過的 Codex CLI projection，適用於雙助理（Claude + Codex）專案。

> **Harness engineering 重於 prompt engineering。** dhpk 把 agent 的運作環境——hooks、sentinel review gate、路由規則、技術棧感知模組——當作施力點。你安裝的不是逐次微調的 one-off prompt，而是一套可重用的 harness，讓正確的檢查自動觸發，並讓模型跨 session 維持在軌道上。

OpenSpec 是**可選的外部整合**——若需要 OpenSpec 工作流指令，請另行安裝 [OpenSpec 插件](https://github.com/Fission-AI/OpenSpec)。dhpk 僅保留自家加值的 `opsx-apply-resume`（長時間 OpenSpec 工作階段的 context handoff）；v0.2.1 起，10 個通用 OpenSpec wrapper skill/command 已從套件中移除，由 OpenSpec 上游提供。

## 前置需求

| 工具 | 狀態 | 用途 |
|------|------|------|
| `bash` | 必要 | 所有 hook 與輔助腳本 |
| `git` | 必要 | Sentinel／artifact 路徑解析；`git rev-parse --show-toplevel` |
| `python3` | 啟用 `modules` 時為必要 | 為選用模組啟用與路由解析 `module.yaml` |
| `jq` | 選用（有 python3 後援） | 較快的 JSON payload 擷取 |
| `docker` | 選用 | 僅由以 `userConfig.docker_containers` 明確註冊的 Docker workflow 使用 |
| Codex CLI 執行檔 | 選用 | 只有使用 CLI-backed role/review、`codex exec` 第二意見，或執行 `install-codex-skills.sh` 且希望 Codex 載入同步內容時才需要 |
| Cursor | 選用 | 僅在執行 `install-cursor-harness.sh` 且希望 Cursor 載入專案本地 `.cursor/` harness 時才需要 |
| `cx` CLI | 選用 | 語意化程式碼導覽。`rules/tool-routing.md` 將 `cx overview` / `cx definition` / `cx references` 列為首選工具；6 個 reviewer agent 與 `code-trace` family 會引用。未安裝時 → 降級為 `Grep` / `Read`。 |
| `gitnexus` MCP server | 選用 | 知識圖譜查詢（`gitnexus_impact`、`gitnexus_rename`、`gitnexus_detect_changes`）。6 個 `gitnexus-*` skill 以及 `rules/execution-policy.md` 的 self-check 會用到。未安裝時 → 降級為 `cx` 或 `Grep`。 |
| `claude-mem` | 選用 | 跨 session 記憶搜尋（`mem-search`）。`rules/tool-routing.md` 用於查找過往決策。未安裝時 → 直接略過。 |

缺少選用工具會以優雅退化處理（腳本 no-op 或跳過該功能）。缺少必要工具則會在生效 hook 需要它時以單行 `[hook-name] WARN: …` 寫到 stderr，方便你採取行動。

外部 code-navigation 工具（`cx`、`gitnexus`、`claude-mem`）**不由 dhpk 內附**，是否安裝由各 consuming 專案決定。dhpk 內附的 rules 與 agents 寫法已預設它們可能不在，會依 [`rules/tool-routing.md`](./rules/tool-routing.md) 自動降級。

## 安裝

dhpk 遵循 [Claude Code plugin 標準發布模式](https://docs.claude.com/en/docs/claude-code/plugins)。最快的路徑（不用 clone）：

```bash
claude plugin marketplace add hmj1026/dhpk
claude plugin install dhpk@dhpk --config modules=php-8.x,laravel-11 --config hook_profile=standard
```

直接使用 GitHub marketplace 是 raw compatibility 路徑。若要在 clean
install 套用已量測、discovery 前的邊界，請使用基本操作指南 Path B 的
`scripts/install.sh`；它會實體化並安裝 `dhpk@dhpk-profile-minimal`。

**需求**：Claude Code 2.x。目前 dhpk workflow 預設不需要 Codex。選用的
Codex CLI 與外部 app-server 整合見[Codex integration surfaces](#codex-整合面)
及 [`docs/configuration.zh-TW.md`](./docs/configuration.zh-TW.md#codex-mcp-依賴並非-userconfig-旋鈕)。

安裝後隨時可用 `/dhpk:setup` 重新設定（或 `/dhpk:setup --show` 印出目前生效設定）。完整安裝路徑（GitHub vs. 本地 clone）、更新／移除、疑難排解請見 **[`docs/basic-operations.zh-TW.md`](./docs/basic-operations.zh-TW.md)**。完整 `--config` 旋鈕參考見 **[`docs/configuration.zh-TW.md`](./docs/configuration.zh-TW.md)**。

## 你會得到什麼

| 元件 | 數量 | 說明 |
|------|----:|------|
| Agents | Role-based agents | Sentinel 驅動的 reviewer，以及架構、測試、安全、文件、平台與 runtime 等情境型角色。 |
| Commands | 已註冊的 command surface | `/dhpk:precommit`、`/dhpk:setup`、`/dhpk:review-pending`、`/dhpk:smart-commit`、`/dhpk:opsx-apply-resume`、`/dhpk:harness-audit`、`/dhpk:harness-govern`、`/dhpk:ui-ux-verify` 等 |
| Canonical skills | 85 個扁平 package | 每個 capability 只有一個具名 package，來源固定在 `skills/<public-name>/`；非 family package 維持 `skills/dhpk-*/` contract，六個 portable family（`skill-scope`、`skill-forge`、`flow-guide`、`flow-drive`、`change-verdict`、`code-trace`）負責整併 mode。 |
| 技術棧模組 | 可選技術棧模組 | PHP、Yii、PHPUnit、Laravel、JavaScript、Vue、Laravel Mix、Next.js、React、Python、`library-author` 與 iOS/Swift 模組 |
| Hooks | 4 個事件 | PreToolUse（Edit guard 與合併 Bash safety/Git gate）、PostToolUse（sentinel routing）、SessionStart（module activation）、SubagentStop（strict reviewer reconciliation） |
| Hook dispatchers | 2 | `post-edit-dispatch.sh` 負責 sentinel routing；`pre-bash-dispatch.sh` 合併 deterministic shell 與 Git/review-debt gate |
| Harness 腳本 | 5 | precommit-runner、verify-runner、harness-audit、codemap generator、dep-audit |
| Codex 雙軌 | 18 筆項目（16 個可呼叫） | 專案同步使用 receipt 管理的 projection；實驗性 native package 則以實體檔發布同一組技能與內部 transport 與 dispatch-context runtime。 |

呼叫語法會依 surface 不同：

| Surface | 語法 | 範例 |
|---|---|---|
| Claude command | `/dhpk:<command>` | `/dhpk:harness-audit` |
| Claude plugin skill | `/dhpk:<public-skill-name>` | `/dhpk:flow-guide` |
| Codex skill | discovery 後使用 `$<public-skill-name>` | `$flow-guide` |

六個 capability family 使用未加前綴的 public name；其他 first-party skill 維持避免
全域撞名的 `dhpk-` 前綴。完整遷移對照見
[`docs/skill-platform-migration.zh-TW.md`](./docs/skill-platform-migration.zh-TW.md)。
Lifecycle、public name 與 publication surface 以
`manifests/distribution-inventory.json` 為準，不以本段 prose 為 SSOT。

## 常見工作流

使用 `flow-guide` 進行分類與 gate 建議，明確使用 `flow-drive` 路由或實作已確認的
工作，使用 `code-trace` 調查、`change-verdict` 唯讀 review、`skill-scope` skill
治理，以及 `skill-forge` authoring。每項的完整說明與範例見 **[`docs/basic-operations.zh-TW.md`](./docs/basic-operations.zh-TW.md)**。

```text
$flow-drive --route-only implement a password-reset email flow # 只檢查路由
$flow-drive implement a password-reset email flow   # 新功能（TDD + review gate）
$flow-drive --worker=codex implement the plan   # 明確指定本次 worker
$code-trace diagnose the login redirect loop              # 根因證據
/dhpk:review-pending                              # 立即觸發待處理的 reviewer
/dhpk:smart-commit && /dhpk:create-pr             # 提交 + 建 PR
/dhpk:harness-audit                              # harness 健康評分
```

`--route-only` 會顯示使用者可讀的 `Route only: /...` 結果（或 bounded
classification／task prompt），並在 planner、worker、OpenSpec 或 skill 執行前停止。
底層 helper 另外提供 machine-readable 的 `MATCH`、`NO_MATCH`、`NO_QUERY` status。
若選定 target 是 `explicit-only`，router 會印出直接 invocation 後停止，不會默默越過
該邊界。完整的 inspect → route → implement → review → verify → handoff 流程請看
[基本操作指南](./docs/basic-operations.zh-TW.md)。

---

## userConfig

59 個旋鈕，全部可在安裝時用 `--config <key>=<value>` 設定，也可隨時用 `/dhpk:setup` 重新設定。完整參考（每個旋鈕在哪裡設定、所有選項、專案層級覆寫語法）見 **[`docs/configuration.zh-TW.md`](./docs/configuration.zh-TW.md)**。

```bash
claude plugin install dhpk@dhpk \
  --config modules=php-7.4,php-8.x,laravel-6,laravel-11,phpunit-9,library-author \
  --config docker_containers=php-fpm,mysql \
  --config hook_profile=standard
```

精選的模組組合請見 `manifests/install-profiles.json`。

Claude 的預設 discovery artifact 是由 distribution inventory 產生的實體化
`minimal` profile，不是直接掃描未過濾的 `skills/` 原始目錄；其中最多包含
15 個 `implicit-eligible` entry。`full` 與 `compat-v1` 仍是明確 opt-in 的
profile artifact。Agent Plugin 與 Cursor 的發布 membership 維持不變；source
tree 仍是 authoring tree。

## Codex 整合面

dhpk 的核心——hooks、sentinel reviewers、Smart Router 與 workflow
skill——不需要 Codex MCP server。選用的 Codex 整合是彼此分離、責任清楚的
surface：

| Surface | 名稱／入口 | 需要 | 失敗或邊界 |
|---------|----------|------|----------|
| CLI-only Codex path | `change-verdict --mode code --backend cli`；同族 role：`codex-worker`、`codex-reasoner`、`codex-reviewer`、`dhpk-codex-bridge` | Codex CLI 執行檔與 hardened wrapper 的 Bash shell-out；不需要 MCP server | 缺少 `codex` 時回報 optional backend 不可用；預設仍使用 current-model path |
| 外部 app-server plugin | `openai/codex-plugin-cc` 與其 `/codex:*` 指令 | 明確安裝外部 plugin；它驅動 `codex app-server` | 與 dhpk skill、CLI review 及已退休的 MCP 機制彼此獨立 |
| 歷史上的已退休 MCP | `mcp__codex__codex`、`mcp__codex__codex-reply` 與 `codex mcp-server` | 本次 migration 已退休；目前沒有 dhpk capability 需要或建議它 | 僅供歷史說明。見[retirement ledger](./docs/skill-platform-migration.zh-TW.md#alias-free-codex-mcp-retirement-ledger)與[capability-parity matrix](./docs/codex-mcp-capability-parity.md)了解各 capability 的 successor |

上表的 MCP 列是歷史資料，不是設定路徑。它記錄過去退休的 Codex-backed
route 使用過的 transport，以及 capability 現在移到哪個 backend-neutral owner。
目前沒有任何 dhpk skill 或 command 依賴該 server；parity matrix 記錄每項能力保留的
CLI、current-model 或 isolated-review 行為。

`CODEX=on` 與 `/dhpk:do --codex` 是已移除的 legacy MCP-peer interface，不是
`codex exec`、`--worker=codex`、`--reasoner=codex` 或外部 app-server plugin 的 alias。
目前請使用明確的 `/dhpk:flow-drive` 走 current-model implementation；需要
外部 CLI role 時明確選 `--worker=codex` 或 `--reasoner=codex`；支援的 migrated skill
若需要第二意見，則明確指定 `codex exec`。legacy flag 只會產生 deprecation diagnostic，
不會選到 hidden backend。

過去 `/dhpk:codex-security` 的語義現在由 backend-neutral `change-verdict` security
mode 與一般 routing 負責；過去的 review family 若需要 CLI review，請使用
`change-verdict --mode code --backend cli`。兩者都不會抵達已退休的 MCP server。完整九項 identity
的 retirement 與 rollback ledger 見 migration guide。

## 外部 code-navigation 工具

`cx`、`gitnexus`、`claude-mem` 是**可選**依賴——不由 dhpk 內附、不自動安裝。內附的 agents / skills / rules 寫法已預設它們可能不存在，並透過 [`rules/tool-routing.md`](./rules/tool-routing.md) 提供確定性的降級路徑。

| 工具 | 主要使用者（節錄） | 缺失時影響 |
|------|------------------|-----------|
| `cx` CLI | Agents：`code-reviewer`、`doc-reviewer`、`doc-updater`、`frontend-reviewer`、`migration-reviewer`、`refactor-cleaner`。Skills：`harness-fill`、`code-trace`、`polyfill-version-matrix-audit`。Rule：`tool-routing.md`（`cx overview` / `cx definition` / `cx references` 為首選）。 | 失去 sub-200 token 的檔案概覽與 AST 等級的符號讀取——降級為 `Grep` + `Read`（耗 token 較多，精度較低）。 |
| `gitnexus` MCP | 專屬 skills：`gitnexus-cli`、`gitnexus-debugging`、`gitnexus-exploring`、`gitnexus-guide`、`gitnexus-impact-analysis`、`gitnexus-refactoring`。Agents：`architect`、`code-reviewer`、`database-reviewer`、`migration-reviewer`、`performance-analyzer`、`refactor-cleaner`、`security-reviewer`、`ui-ux-verifier`。Rules：`execution-policy.md` self-check（`gitnexus_impact`）、`tool-routing.md`。 | 失去跨檔案 blast-radius 分析（`gitnexus_impact`）、安全 global rename（`gitnexus_rename`）、pre-commit 範圍檢查（`gitnexus_detect_changes`）——降級為 `cx references` / `git diff --stat` / **find-and-replace 禁用**。 |
| `claude-mem` | Rule：`tool-routing.md` 的「Past decisions (cross-session)」入口。 | 失去跨 session 記憶搜尋；當前 session 仍可從 scrollback 取得脈絡。 |

詳細的路由判斷規則見 [`rules/tool-routing.md`](./rules/tool-routing.md)；prose 與 sub-agent 樣板版本由 `code-trace` family 的 `select-tool` mode 提供。

## Rules（資源層）

`rules/` 內附四份 plain-markdown 資源，**不註冊於 `plugin.json`**，由 consuming 專案自行 opt-in。在專案 `CLAUDE.md` 內以 `@${CLAUDE_PLUGIN_ROOT}/rules/<file>.md` 載入。目前提供：

- `execution-policy.md` — pre-plan checklist、anti-loop、self-check gate。
- `tool-routing.md` — 上述 `cx` / `gitnexus` / `claude-mem` 決策樹。
- `anti-rationalization.md` — 防止檢查失敗時的事後合理化。
- `model-economics.md` — 成本/分級 SSOT：role→model-tier 對照表、reviewer 升級規則，以及 deep-reasoner/fast-worker 的 effort 調節。

## 模組

**模組**是有標籤、有版本號的 skill + 參考資料 + hook + trigger 貢獻組合，由 `userConfig.modules` 控管啟用。同一軸線（PHP / Laravel / PHPUnit）的模組是**加法式**的——橫跨 Laravel 6–11 的函式庫應全數啟用以取得累積指引。目前內附：

**PHP 語言基線** — 依你 composer `require.php` 約束涵蓋的版本選擇：
- **`php-5.6`** — 禁止 7.0+ 語法；提供 polyfill 指引。
- **`php-7.4`** — typed properties、arrow functions、null coalescing assignment，以及 php-cs-fixer、pre-commit lint、phpstan、psalm 指引。任何 formatter hook 均由 consumer 明確註冊。
- **`php-8.x`** — readonly、enums、match、named args、attributes、first-class callable syntax。

**框架**：
- **`yii-1.1`** — Yii 1.1：alias autoload、`CActiveRecord` / `CDbCriteria`、`accessRules`、XSS / CSRF 預設。需要 `php-5.6`。
- **`laravel-5.4`** — Laravel 5.4（LTS，2017/02）：Blade components & slots、route model binding、middleware groups、realtime facades、markdown mailables、Elixir → Mix 轉換；5.3 → 5.4 陷阱。需要 `php-5.6`。
- **`laravel-6`** … **`laravel-11`** — 每個主版本一個模組。各版本：Eloquent / collection / cast / migration / queue / event / mail / notification / package-discovery 差異；Testbench 對照；deprecated 牆。

**測試**：
- **`phpunit-5.7`** — PHPUnit 5.7 assertion API 與用法。需要 `php-5.6`。
- **`phpunit-9`** / **`phpunit-10`** / **`phpunit-11`** — 各主版本 API 差異（`createMock` vs `createPartialMock`、attribute-based metadata、deprecation surface）。

**前端**：
- **`js`** — JS / TS 工具鏈。ESLint flat-config 分層策略（Tier 1 嚴格 / 1.5 core-exempt / 1.7 deferred-migration / globals）、per-leaf `// @ts-check` 漸進啟用、按需 ESLint 反饋，以及 pre-commit `npm run <lint> + <typecheck>` gate。框架無關。
- **`vue-2`** — Vue 2（Options API 時代，`^2.5`）：`data()` / `computed` / `methods` / `watch` + 生命週期結構、props-down + `$emit` events-up、Vue 2 reactivity 陷阱（`Vue.set` / 陣列索引與長度）、`@vue/test-utils` 1.x + `vue-jest` 3 SFC 測試。早於 Composition API。
- **`laravel-mix`** — Laravel Mix 5（`^5.0.9`，webpack 4）：`webpack.mix.js` 入口/輸出對映、`mix()` versioning + manifest、`dev` / `watch` / `hot` / `prod` 腳本階梯、新版 Node 上 prod build 的 legacy-OpenSSL flag。
- **`nextjs-15.5`** — Next.js 15.5（現行穩定的 15.x 線，止於 v15.5.19；15.6 未曾發布穩定版）。App Router、`next typegen`、穩定 typed routes（`typedRoutes`）、beta Turbopack 生產建置（`next build --turbopack`）、React 18/19 雙支援，以及 `next lint` 棄用（16 移除）。
- **`nextjs-16`** — Next.js 16（現行穩定主版本，16.2.x）。Turbopack 於 dev + build 預設啟用、Request API 改為 async-only（`params`/`searchParams`/`cookies`/`headers`）、Node.js 20.9+ / TypeScript 5.1+ 下限、`next lint` 與 AMP 移除、`next/image` `priority`→`preload`、`next upgrade` CLI（16.1）。支援 React 18.2+/19（建議 React 19，但非必需）。
- **`react-18`** — React 18（2022 年 3 月）。`createRoot`/`hydrateRoot`（`react-dom/client`）、automatic batching、可選用的 concurrent features（`startTransition`/`useTransition`/`useDeferredValue`）、streaming SSR（`renderToPipeableStream`）、新 hooks（`useId`/`useSyncExternalStore`/`useInsertionEffect`），以及 StrictMode 於 dev 重複執行 effect。React 18.2+ 是 Next.js 16 支援的下限。
- **`react-19`** — React 19（2024 年 12 月）。Actions 與 async transitions、新 hooks（`useActionState`/`useOptimistic`/`useFormStatus`、`use()`）、`ref` 作為一般 prop（免 `forwardRef`）、`<Context>` 直接當 provider、document metadata 自動 hoist、資源預載（`preload`/`preinit`）、穩定的 Server Components。移除 `ReactDOM.render`/`hydrate`、function component 的 `propTypes`/`defaultProps`、legacy Context 與 string refs。Next.js 16 建議但非必需。

**跨版本**：
- **`library-author`** — 多主版本 PHP 函式庫（Laravel 6–11、Monolog 2/3、PHPUnit 8–11、Flysystem 1/3 等）的跨版本膠水。附帶**第六色** `polyfill-reviewer` agent（透過 `.pending-polyfill-review` sentinel 驅動）、`polyfill-version-matrix-audit` skill、`matrix-cell-onboard` skill（+ 根目錄 `/dhpk:dhpk-matrix-cell-onboard` 別名）、OpenSpec artifact guard，以及雙測試套件映射輔助。在包含 runtime 版本 guard（`version_compare`、`class_exists`、`method_exists`、`Composer\InstalledVersions::*`）的 `.php` 編輯時自動觸發。

**iOS / Swift**（依賴鏈式——每個都 `requires: swift`；可用 `ios-app` 安裝 profile 一次啟用整套）：
- **`swift`** — Swift 6 strict-concurrency 基線 + Swift 5.10 / iOS 17 相容性 + Swift 6.2 approachable-concurrency。整套套件的基礎。
- **`swiftui`** — MVVM + Coordinator、Observation（`@Observable` / `@Bindable`）、`NavigationStack` 路由、Combine / UIKit 互通。需要 `swift`。
- **`ios-platform`** — health/PHI iOS SDK：Core Data 加密、CryptoKit + Keychain、actor 離線儲存、Vision OCR、LocalAuthentication、UserNotifications、HealthKit、隱私合規。需要 `swift`。
- **`swift-testing`** — XCTest + Swift Testing、XCUITest、snapshot 測試、3 層測試分類、protocol-DI host testing。需要 `swift`。
- **`xcode-tooling`** — SwiftLint 指引、xcodebuild/SPM pre-commit build+test gate（generic build destination、模擬器自動回退、工具鏈不存在時自動跳過），以及 `ios-icon-gen` skill。需要 `swift`；任何 SwiftLint hook 由 consumer 明確註冊。

啟用後，模組會：
- 將其 skill 以 `dhpk:<skill-name>` 形式暴露（例如 `dhpk:dhpk-php-runtime-router`、`dhpk:dhpk-yii1-security-audit`、`dhpk:dhpk-js-lint-config`）。
- 為 deterministic post-edit sentinel routing 貢獻路徑觸發規則，讓 reviewer 在框架特定路徑上觸發。
- 可在 `modules/<m>/hooks/` 提供選用 hook 腳本；由 consumer 明確註冊。詳見 [`docs/hook-extension.zh-TW.md`](./docs/hook-extension.zh-TW.md)。
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

模組可在 `modules/<stack>-<version>/hooks/` 內提供 hook 腳本；啟用方式依 hook 類型而異：

- `post-edit-*.sh` — 明確註冊後才執行 advisory post-edit 工作。
- `pre-bash-*.sh` / `pre-commit-*.sh` — module active 時會透過合併的
  `PreToolUse(Bash)` dispatcher 自動執行；非零 status 可能阻擋 Bash 呼叫。

Dispatcher 契約與 `js` 模組的完整範例詳見 [`docs/hook-extension.zh-TW.md`](./docs/hook-extension.zh-TW.md)。

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

Statusline 會渲染 `[branch] +staged ~modified | docker:status | profile=<p> | mod=<active> | ⚠ <pending-sentinels>`，並退回到全域 `~/.claude/statusline.sh` 取得 token/模型/rate-limit 行。Sentinel badge 直接取用共用的 `SENTINEL_SHORT_NAMES` map，因此七個 review slot 永遠遵循 SSOT 順序（包含 migration review 的 `⚠ mig`）。

## 同步 Codex CLI 內容

適用於同時使用 Claude Code 與獨立 Codex CLI 的專案（與上方已退休的 MCP 機制不同，
這條路徑不需要 MCP server），支援路徑是 `bash
"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"`。預設 hybrid
projection 讓 skill/supporting asset 連回 plugin root，但 agent TOML 一律 materialize
為實體檔；`--copy` 則是整體實體化的可攜 fallback。它會把明確策展的 Codex projection
放進專案 `.codex/`。[issue #88](https://github.com/hmj1026/dhpk/issues/88) 的乾淨安裝
materialization 驗證目前已對正式實體 package 通過；Codex Plugin Marketplace 仍維持
實驗性，直到另有獨立的 graduation 決策。完整政策與說明見
**[`docs/basic-operations.zh-TW.md`](./docs/basic-operations.zh-TW.md#同步-codex-cli-內容)**。

## 同步 Cursor project-local harness

若希望 Cursor 從專案本身載入 dhpk skills、subagents、`.mdc` rules 與 commands
（而不只依賴 `~/.cursor/plugins/local/`），支援路徑是
`bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh"`。預設
仍採全 symlink 預設；`--copy` 是可攜 fallback。installer 會寫入
schema-v3 receipt `.cursor/.dhpk-installed.json`，且不會寫入
`.cursor/hooks.json`。`plugins/dhpk-cursor/` 仍留給 marketplace／user-plugin
路徑。完整政策見 **[`docs/platform-installation.zh-TW.md`](./docs/platform-installation.zh-TW.md)**。

## 遷移現有專案

若專案已有自己的 `.claude/` harness，dhpk 支援分階段的並行安裝 → hook 對齊 → 切換流程，每階段都有 rollback gate。完整 6 階段步驟見 **[`docs/basic-operations.zh-TW.md`](./docs/basic-operations.zh-TW.md#遷移現有專案)**。

## 儲存庫結構

```
dhpk/
├── .claude-plugin/
│   ├── marketplace.json          # 單一條目的 marketplace（plugins[0].source: "./"）
│   └── plugin.json               # 含 userConfig 的插件 manifest
├── agents/                       # 36 個角色 agent（35 root + 1 模組 reviewer；INDEX.md 為導覽用）
├── commands/                     # slash 指令（review、setup、smart-commit、opsx-apply-resume 等）
├── skills/                       # SSOT：85 個扁平 canonical package，根目錄為 skills/<public-name>/（六個 portable family 名稱不加前綴）
├── templates/                    # hook 引導用範本（graduation-candidates.md — 首次 graduation 執行時複製到 .claude/artifacts/）
├── modules/                      # 31 個可選用模組；skills/ 項目為相對 symlink projection
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
├── hooks/hooks.json              # PreToolUse / PostToolUse / SessionStart / SubagentStop 連線設定
├── scripts/
│   ├── hooks/                    # 核心 hook，含 post-edit-dispatch.sh、pre-bash-dispatch.sh、reap-stale-sentinels.sh、_lib/{payload,portable-sed,portable-timeout}.sh
│   ├── statusline/statusline.sh
│   ├── codemaps/、lib/、opsx-apply-resume/、validate/
│   └── （harness-audit、precommit-runner、verify-runner、agy-adapt-agents、dep-audit）
├── docs/
│   ├── configuration.md、configuration.zh-TW.md      # 完整 userConfig 參考
│   ├── basic-operations.md、basic-operations.zh-TW.md # 安裝與工作流生命週期
│   ├── distribution-surfaces.md、distribution-surfaces.zh-TW.md
│   ├── skill-platform-migration.md、skill-platform-migration.zh-TW.md
│   ├── hook-extension.md、hook-extension.zh-TW.md
│   ├── recommended-permissions.md
│   ├── docker-setup.md、docker-setup.zh-TW.md、subagent-prompt-template.md
├── cursor/                       # Cursor project-local 雙軌（Cursor 不會自動載入）
│   ├── AGENTS.md                 # Cursor 雙路徑指引
│   ├── skills/                   # 指向 canonical skills/ 的相對 symlink
│   ├── agents/、rules/*.mdc、commands/
├── codex/                        # Codex CLI 雙軌（Claude Code 不會自動載入）
│   ├── AGENTS.md                 # Codex 專屬指引
│   ├── README.md、README.zh-TW.md # 如何同步進專案
│   ├── skills/                   # 18 個相對 symlink（16 個可呼叫加內部 transport 與 dispatch-context runtime）
│   ├── agents/、config.toml.example
├── .codex-plugin/plugin.json     # Codex plugin manifest（marketplace 可安裝，實驗性）
├── plugins/dhpk/                 # 追蹤中的 Codex-native package：18 個實體項目、零 symlink
│   ├── .codex-plugin/plugin.json
│   ├── README.md
├── .agents/plugins/marketplace.json  # repo-scoped Codex marketplace descriptor
├── manifests/
│   ├── distribution-inventory.json  # lifecycle/name/surface SSOT（schema v2）
│   ├── install-profiles.json         # 精選模組組合
│   └── module-catalog.json           # 模組設定 SSOT
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

Marketplace 安裝路徑（`claude plugin install`）會把插件複製到 `~/.claude/plugins/cache/`，所以對原始 repo 的編輯在那裡不會生效，必須 `claude plugin update dhpk@dhpk` 才會更新。

## 授權

採用 [MIT License](./LICENSE) 釋出。Copyright (c) 2026 Paul.

發布歷史見 [CHANGELOG.md](./CHANGELOG.md)。
