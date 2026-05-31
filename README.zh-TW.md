# dhpk — Claude Code 開發 Harness 插件套件

> **語言**: [English](./README.md) · **繁體中文**

通用、安裝即用的 Claude Code harness。內含 **17 個角色導向 agent**（+1 個模組範圍的 reviewer）、約 73 個指令（codex / gitnexus / git / 專案工作流）、約 57 個核心 skill 加上跨專案的 `deploy-list` 部署清單產生器 + **`/dhpk:do` Smart Router**（透過 21 條 route-table 規則 + LLM fallback 進行自然語言任務路由）+ **跨 session 學習 DB**（作業訊號儲存庫，附信心衰退機制，預設關閉）、**6-slot sentinel 驅動的 review hook**（code / db / sec / frontend / doc / **polyfill** — 最後一個由 `library-author` 提供）、statusline、harness 腳本，以及 **21 個可選用的技術棧模組**（PHP：`php-5.6`、`php-7.4`、`php-8.x`；Yii：`yii-1.1`；PHPUnit：`phpunit-5.7`、`phpunit-9`、`phpunit-10`、`phpunit-11`；Laravel：`laravel-6` 至 `laravel-11`；`js`；跨版本的 `library-author`；以及 **iOS/Swift 套件**（`swift`、`swiftui`、`ios-platform`、`swift-testing`、`xcode-tooling`））。模組可透過 **wrapper-dispatch** 模型在 runtime 提供 hook（詳見 [`docs/hook-extension.md`](./docs/hook-extension.md)）。內附平行的 Codex CLI 樹，適用於雙助理（Claude + Codex）專案。

OpenSpec 是**可選的外部整合**——若需要 OpenSpec 工作流指令，請另行安裝 [OpenSpec 插件](https://github.com/Fission-AI/OpenSpec)。dhpk 僅保留自家加值的 `opsx-apply-resume`（長時間 OpenSpec 工作階段的 context handoff）；v0.2.1 起，10 個通用 OpenSpec wrapper skill/command 已從套件中移除，由 OpenSpec 上游提供。

## 前置需求

| 工具 | 狀態 | 用途 |
|------|------|------|
| `bash` | 必要 | 所有 hook 與輔助腳本 |
| `git` | 必要 | Sentinel／artifact 路徑解析；`git rev-parse --show-toplevel` |
| `python3` | 啟用 `modules` 時為必要 | 在 `post-edit-remind` 與 `session-start` 中解析 `module.yaml` |
| `jq` | 選用（有 python3 後援） | 較快的 JSON payload 擷取 |
| `docker` | 選用 | 僅在 `userConfig.docker_containers` 非空時會被使用 |
| Codex MCP server | 選用 | 僅在你使用 14 個 `codex-*` skill 時才需要（需另行安裝） |
| Codex CLI 執行檔 | 選用 | 僅在執行 `install-codex-skills.sh` 且希望 Codex 真正載入同步內容時才需要 |
| `cx` CLI | 選用 | 語意化程式碼導覽。`rules/tool-routing.md` 將 `cx overview` / `cx definition` / `cx references` 列為首選工具；6 個 reviewer agent 與 `goal-ex` skill 會引用。未安裝時 → 降級為 `Grep` / `Read`。 |
| `gitnexus` MCP server | 選用 | 知識圖譜查詢（`gitnexus_impact`、`gitnexus_rename`、`gitnexus_detect_changes`）。6 個 `gitnexus-*` skill 以及 `rules/execution-policy.md` 的 self-check 會用到。未安裝時 → 降級為 `cx` 或 `Grep`。 |
| `claude-mem` | 選用 | 跨 session 記憶搜尋（`mem-search`）。`rules/tool-routing.md` 用於查找過往決策。未安裝時 → 直接略過。 |

缺少選用工具會以優雅退化處理（腳本 no-op 或跳過該功能）。缺少必要工具則會在 SessionStart 或第一個 hook 觸發時以單行 `[hook-name] WARN: …` 寫到 stderr，方便你採取行動。

外部 code-navigation 工具（`cx`、`gitnexus`、`claude-mem`）**不由 dhpk 內附**，是否安裝由各 consuming 專案決定。dhpk 內附的 rules 與 agents 寫法已預設它們可能不在，會依 [`rules/tool-routing.md`](./rules/tool-routing.md) 自動降級。

## 安裝

dhpk 遵循 [Claude Code plugin 標準發布模式](https://docs.claude.com/en/docs/claude-code/plugins)：同一份 marketplace + manifest 可從**兩個入口**使用，依你的習慣挑一個即可：

- **Terminal** — `claude plugin marketplace add …` / `claude plugin install …`
- **Claude Code session 內** — `/plugin marketplace add …` / `/plugin install …`（或 `/plugin` 互動式瀏覽器）

兩個入口都讀同一份 `.claude-plugin/marketplace.json`，結果一致。

### Path A — 從 GitHub 安裝（推薦）

不用 clone。一般使用者的最短路徑。

```bash
# Terminal
claude plugin marketplace add hmj1026/dhpk
claude plugin install dhpk@dhpk
```

```text
# …或在 Claude Code 內
/plugin marketplace add hmj1026/dhpk
/plugin install dhpk@dhpk
```

要在安裝時就帶入設定，加 `--config`（若你想之後用 `/dhpk:setup` 互動回答就跳過）：

```bash
claude plugin install dhpk@dhpk \
  --config modules=php-8.x,laravel-11,phpunit-11,library-author \
  --config docker_containers=php-fpm,mysql \
  --config hook_profile=standard
```

要鎖定特定版本，後面接版本號：`claude plugin install dhpk@dhpk@v0.6.0`。可用技術棧／版本列在 `manifests/module-catalog.json`（SSOT）；精選組合在 `manifests/install-profiles.json`。Docker 前置須知請見 [`docs/docker-setup.md`](./docs/docker-setup.md)。

安裝後，可隨時在 Claude Code 內重新設定：

```text
/dhpk:setup           # 重跑同一份問答
/dhpk:setup --show    # 印出目前生效設定
```

### Path B — 本地 clone + 互動安裝精靈

如果你想要在 Claude 之外有 shell 安裝精靈，或本來就會改 plugin 原始碼，走這條。**必須先 `git clone`**，因為精靈腳本在 repo 裡。

```bash
git clone https://github.com/hmj1026/dhpk ~/projects/dhpk
claude plugin marketplace add ~/projects/dhpk
bash ~/projects/dhpk/scripts/install.sh        # 互動（gum / python3 fallback）
```

精靈會帶你選技術棧／版本、設定 docker 前置條件、覆寫 review agent、選 hook profile，最後幫你執行 `claude plugin install`。加 `--dry-run` 只印出組好的指令、不實際執行。

任何時候都可以驗證 local checkout：

```bash
claude plugin validate ~/projects/dhpk --strict
```

要邊改 plugin 原始碼邊看效果（不走 install/reinstall 迴圈），請見 [§ 開發](#開發)。

### 更新／移除

```bash
claude plugin update dhpk              # 從 marketplace 拉最新版
claude plugin uninstall dhpk           # 移除 plugin
claude plugin marketplace remove dhpk  # 忘記 marketplace 註冊
```

在 Claude Code 內也可以用 `/plugin update dhpk`、`/plugin uninstall dhpk`、`/plugin marketplace remove dhpk`。

### Troubleshooting

| 症狀 | 可能原因 | 解法 |
|---|---|---|
| `marketplace add` 說路徑不存在 | 你走 Path B 但沒先 clone | 先跑 `git clone https://github.com/hmj1026/dhpk ~/projects/dhpk`，或直接改用 Path A（不用 clone） |
| `claude plugin install dhpk@dhpk` 找不到 marketplace | `marketplace add` 沒跑過，或已被移除 | 重跑你那條路徑的 `marketplace add` 指令 |
| 裝完但 `/dhpk:*` 命令或 hooks 沒出現 | session 在安裝完成前就讀過 skill list | 在 Claude Code 內 `/reload-plugins`，或重啟 session |
| `claude plugin list` 看到 dhpk 但 `/dhpk:setup` 不存在 | plugin 裝起來但停用了 | `claude plugin enable dhpk`（或 `/plugin enable dhpk`） |
| `install.sh` 抱怨找不到 `gum` / `jq` | 互動 UI 的選用依賴沒裝 | 腳本會自動 fallback 到純 shell / `python3`，想要更好看可裝 `gum` 與 `jq`，不裝也能用 |

## 你會得到什麼

| 元件 | 數量 | 說明 |
|------|----:|------|
| Agents | 17 root + 1 module | 5 個 sentinel 驅動的 reviewer（code / db / sec / **frontend** / **doc**）+ 第 6 個 `polyfill-reviewer` 由 `library-author` 提供。`migration-reviewer` 為 `database-reviewer` 的 sentinel 驅動同伴（觸發 `.pending-migration-review`）。情境型：architect、tdd-guide、refactor-cleaner、ui-ux-verifier、performance-analyzer、doc-updater、docs-lookup、harness-reviser、harness-optimizer、version-matrix-impact-reviewer、**swift-build-resolver**（iOS 套件）。 |
| Commands | ~73 | `dhpk:do`（Smart Router）、`dhpk:create-dev`、`dhpk:codex-*`、`dhpk:review-pending`、`dhpk:smart-commit`、`dhpk:ts-check-status`（JS 模組）、`dhpk:opsx-apply-resume`（需 OpenSpec）、`dhpk:matrix-cell-onboard`（library-author）、`dhpk:de-ai-flavor`、`dhpk:deploy-list`、`dhpk:goal-ex`、`dhpk:ui-ux-verify` 等 |
| 核心 skills | ~57 加上 | codex-*、gitnexus、tool-routing、dhpk-execution-policy、**adaptive-dev-workflow**（Feature/Bug/Maintenance 分類器）、**deploy-list**（跨專案部署清單產生器）、**execution-checklist**（任務收尾自檢）、`opsx-apply-resume` 配套（需 OpenSpec） |
| 技術棧模組 | 21 | PHP：`php-5.6`、`php-7.4`、`php-8.x` · Yii：`yii-1.1` · PHPUnit：`phpunit-5.7`、`phpunit-9`、`phpunit-10`、`phpunit-11` · Laravel：`laravel-6` … `laravel-11` · `js` · `library-author` · **iOS**：`swift`、`swiftui`、`ios-platform`、`swift-testing`、`xcode-tooling`（選用；詳見下方「模組」） |
| Hooks | 9 個事件 | PreToolUse（Edit、Bash + dispatcher + sentinel-gate + branch-safety）、PostToolUse（Edit + dispatcher + async crlf-fix）、SessionStart、PreCompact（checkpoint 存檔）、PostCompact（sentinel 還原）、SubagentStop（reviewer 驗證 + 失敗記錄）、StopFailure（失敗記錄）、UserPromptSubmit（skill 提示）、Stop（review-reminder + graduation-scan + reap-stale-sentinels） |
| Hook dispatchers | 2 | `post-edit-dispatch.sh`、`pre-bash-dispatch.sh` — 分派到啟用模組的 hook |
| Harness 腳本 | 5 | precommit-runner、verify-runner、harness-audit、codemap generator、dep-audit |
| Codex 雙軌 | 14 skills + 1 agent（5 個 config profile） | 由 `install-codex-skills.sh` 同步進專案的 `.codex/` |

## userConfig

二十二個旋鈕，全部可在安裝時用 `--config <key>=<value>` 設定：

| Key | 預設值 | 用途 |
|-----|--------|------|
| `hook_profile` | `standard` | `minimal` 抑制 Stop 提醒；`strict` 增加額外警告 |
| `review_agents` | `["code-reviewer","database-reviewer","security-reviewer","frontend-reviewer","doc-reviewer"]` | 被 sentinel 提醒呼叫的 5 個 agent。可覆寫指向你專案特定的 agent；傳入較短的清單會縮減覆蓋範圍。（第 6 個 `polyfill-reviewer` slot 由 `library-author` 模組啟用，不在此清單中。） |
| `docker_containers` | `[]` | 在 SessionStart 檢查的 container 名稱。空陣列代表停用該檢查。第一筆會輸出為 `DHPK_PHP_CONTAINER`；第二筆為 `DHPK_MYSQL_CONTAINER`。 |
| `modules` | `[]` | 要啟用的技術棧模組。內附 21 個：`php-5.6`、`php-7.4`、`php-8.x`、`yii-1.1`、`phpunit-5.7`、`phpunit-9`、`phpunit-10`、`phpunit-11`、`laravel-6`、`laravel-7`、`laravel-8`、`laravel-9`、`laravel-10`、`laravel-11`、`js`、`library-author`、`swift`、`swiftui`、`ios-platform`、`swift-testing`、`xcode-tooling`。模組的 `requires:` 在 SessionStart 驗證（僅警告、不阻擋）。專案層級的 `.claude/settings.local.json` `pluginConfigs.dhpk@dhpk.options.modules` 可**覆寫**全域值——讓單台開發機同時服務不同技術棧的多個專案。 |
| `review_trigger_extra_paths` | `[]` | 每個 reviewer slot 的額外路徑前綴。格式：`<slot>:<prefix>`，slot 屬於 `code\|db\|sec\|fe\|doc`。例：`code:protected/`、`fe:resources/views/`。 |
| `reap_stale_mcp_processes` | `false` | 設 `true` 時，SessionStart 會 reap 舊的 `gitnexus mcp` process（只留最新）。僅 gitnexus MCP 使用者需要。 |
| `js_lint_script` | `"lint"` | `js` 模組 pre-commit gate 執行的 npm script 名稱。 |
| `js_typecheck_script` | `"typecheck"` | `js` 模組 pre-commit gate 執行的 npm script 名稱。 |
| `js_check_path` | `"js/"` | `/ts-check-status` 掃描 `// @ts-check` 推進度時的路徑。 |
| `sentinel_commit_gate` | `"warn"` | `warn` \| `block` \| `off` — 在 reviewer sentinel 存在時對 `git commit/merge/rebase/cherry-pick` 設閘門。可用 `DHPK_SENTINEL_COMMIT_GATE` 單次覆寫。 |
| `branch_safety` | `"warn"` | `warn` \| `block` \| `off` — 在受保護分支上對破壞歷史的 git 操作（`commit/merge/rebase/cherry-pick/reset/push`）設閘門。可用 `DHPK_BRANCH_SAFETY` 單次覆寫。 |
| `protected_branches` | `["main","master","develop","release/*","hotfix/*"]` | `branch_safety` 檢查的分支 glob 清單，使用 bash `case` glob 語法。 |
| `skill_hint_enabled` | `true` | 是否由 UserPromptSubmit hook 印出一行 route-table skill 提示。可用 `DHPK_DISABLE_SKILL_HINT=1`（單次）或設此值為 `false`（持久）關閉。 |
| `learning_db_enabled` | `false` | （v0.6.0）啟用 `.claude/artifacts/learning.jsonl` 作業訊號儲存庫（reviewer 通過 / subagent 失敗 / 異常停止）。在 SessionStart 以 `[learned-context]` 區塊呈現。 |
| `graduation_scan_enabled` | `false` | （v0.6.0）啟用 Stop hook，掃描 session transcript 中被引用的 auto-memory 條目，並起草 `graduation-candidates.md` 升階提案。 |
| `swiftlint_bin` | `"swiftlint"` | （v0.7.0）`xcode-tooling` post-edit SwiftLint hook 使用的執行檔；不存在時自動跳過。 |
| `xcode_scheme` | `""` | （v0.7.0）`xcode-tooling` pre-commit build gate 使用的 scheme；留空則跳過 gate（不猜測 scheme）。 |
| `xcode_destination` | `""` | （v0.7.0）pre-commit gate 測試步驟的 `-destination`；留空則自動挑選第一個可用模擬器（build 步驟一律使用不含裝置名稱的 generic destination）。 |
| `swift_build_skip_tests` | `false` | （v0.7.0）設 `true` 時，Swift pre-commit gate 只 build、不跑測試（無 `xcodebuild test` / `swift test`）。 |
| `php_cs_fixer_bin` | `"vendor/bin/php-cs-fixer"` | `php-7.4` 模組 post-edit php-cs-fixer hook 與 pre-commit gate 使用的執行檔。 |
| `phpstan_bin` | `"vendor/bin/phpstan"` | `php-7.4` 模組 pre-commit gate 使用的 PHPStan 執行檔。 |
| `psalm_bin` | `"vendor/bin/psalm"` | `php-7.4` 模組 pre-commit gate 使用的 Psalm 執行檔。 |

範例：

```bash
# 以預設值純安裝（6-slot 預設 agent 名稱）。
claude plugin install dhpk@dhpk

# 舊版 PHP/Yii + JS 全端專案。
claude plugin install dhpk@dhpk \
  --config modules=php-5.6,yii-1.1,phpunit-5.7,js \
  --config docker_containers=php-fpm,mysql \
  --config review_agents=code-reviewer-myproj,db-reviewer-myproj,sec-reviewer-myproj,fe-reviewer-myproj,doc-reviewer-myproj

# 橫跨 Laravel 6–11 的現代 PHP 套件函式庫（含 polyfill review）。
claude plugin install dhpk@dhpk \
  --config modules=php-7.4,php-8.x,laravel-6,laravel-11,phpunit-9,library-author
```

精選的模組組合請見 `manifests/install-profiles.json`。

## 需要 MCP 依賴的 skill

6 個 skill 需要 **Codex MCP server**（`mcp__codex__codex`、`mcp__codex__codex-reply`）：

```
codex-architect       codex-brainstorm     codex-cli-review
codex-code-review     codex-explain        codex-implement
```

未安裝 Codex 時，呼叫上述任一 skill 會出現工具權限錯誤。請另行安裝（請參考 Anthropic 的 Codex 文件），安裝後即可使用。

其他 skill（約 51 個）沒有 MCP 依賴。

## 外部 code-navigation 工具

`cx`、`gitnexus`、`claude-mem` 是**可選**依賴——不由 dhpk 內附、不自動安裝。內附的 agents / skills / rules 寫法已預設它們可能不存在，並透過 [`rules/tool-routing.md`](./rules/tool-routing.md) 提供確定性的降級路徑。

| 工具 | 主要使用者（節錄） | 缺失時影響 |
|------|------------------|-----------|
| `cx` CLI | Agents：`code-reviewer`、`doc-reviewer`、`doc-updater`、`frontend-reviewer`、`migration-reviewer`、`refactor-cleaner`。Skills：`goal-ex`、`tool-routing`、`polyfill-version-matrix-audit`。Rule：`tool-routing.md`（`cx overview` / `cx definition` / `cx references` 為首選）。 | 失去 sub-200 token 的檔案概覽與 AST 等級的符號讀取——降級為 `Grep` + `Read`（耗 token 較多，精度較低）。 |
| `gitnexus` MCP | 專屬 skills：`gitnexus-cli`、`gitnexus-debugging`、`gitnexus-exploring`、`gitnexus-guide`、`gitnexus-impact-analysis`、`gitnexus-refactoring`。Agents：`architect`、`code-reviewer`、`database-reviewer`、`migration-reviewer`、`performance-analyzer`、`refactor-cleaner`、`security-reviewer`、`ui-ux-verifier`。Rules：`execution-policy.md` self-check（`gitnexus_impact`）、`tool-routing.md`。 | 失去跨檔案 blast-radius 分析（`gitnexus_impact`）、安全 global rename（`gitnexus_rename`）、pre-commit 範圍檢查（`gitnexus_detect_changes`）——降級為 `cx references` / `git diff --stat` / **find-and-replace 禁用**。 |
| `claude-mem` | Rule：`tool-routing.md` 的「Past decisions (cross-session)」入口。 | 失去跨 session 記憶搜尋；當前 session 仍可從 scrollback 取得脈絡。 |

詳細的路由判斷規則見 [`rules/tool-routing.md`](./rules/tool-routing.md)；prose 與 sub-agent 樣板版本見 `dhpk:tool-routing` skill。

## Rules（資源層）

`rules/` 內附三份 plain-markdown 資源，**不註冊於 `plugin.json`**，由 consuming 專案自行 opt-in。在專案 `CLAUDE.md` 內以 `@${CLAUDE_PLUGIN_ROOT}/rules/<file>.md` 載入。目前提供：

- `execution-policy.md` — pre-plan checklist、anti-loop、self-check gate。
- `tool-routing.md` — 上述 `cx` / `gitnexus` / `claude-mem` 決策樹。
- `anti-rationalization.md` — 防止檢查失敗時的事後合理化。

## 模組

**模組**是有標籤、有版本號的 skill + 參考資料 + hook + trigger 貢獻組合，由 `userConfig.modules` 控管啟用。同一軸線（PHP / Laravel / PHPUnit）的模組是**加法式**的——橫跨 Laravel 6–11 的函式庫應全數啟用以取得累積指引。目前內附：

**PHP 語言基線** — 依你 composer `require.php` 約束涵蓋的版本選擇：
- **`php-5.6`** — 禁止 7.0+ 語法；提供 polyfill 指引。
- **`php-7.4`** — typed properties、arrow functions、null coalescing assignment。連線 **php-cs-fixer post-edit hook** + pre-commit lint + phpstan + psalm gate。
- **`php-8.x`** — readonly、enums、match、named args、attributes、first-class callable syntax。

**框架**：
- **`yii-1.1`** — Yii 1.1：alias autoload、`CActiveRecord` / `CDbCriteria`、`accessRules`、XSS / CSRF 預設。需要 `php-5.6`。
- **`laravel-6`** … **`laravel-11`** — 每個主版本一個模組。各版本：Eloquent / collection / cast / migration / queue / event / mail / notification / package-discovery 差異；Testbench 對照；deprecated 牆。

**測試**：
- **`phpunit-5.7`** — PHPUnit 5.7 assertion API 與用法。需要 `php-5.6`。
- **`phpunit-9`** / **`phpunit-10`** / **`phpunit-11`** — 各主版本 API 差異（`createMock` vs `createPartialMock`、attribute-based metadata、deprecation surface）。

**工具 / 跨版本**：
- **`js`** — JS / TS 工具鏈。ESLint flat-config 分層策略（Tier 1 嚴格 / 1.5 core-exempt / 1.7 deferred-migration / globals）、per-leaf `// @ts-check` 漸進啟用、async post-edit ESLint 反饋、pre-commit `npm run <lint> + <typecheck>` gate。框架無關。
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

同時使用 Claude Code 與 Codex CLI 的專案：

```bash
# 在任意專案根目錄執行：
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```

預設以 symlink（或用 `--copy` 複製）把插件的 `codex/{skills,agents}` 連到專案的 `.codex/`。具冪等性 — 插件版本 bump 後可用 `--update` 重跑。雙 harness 模型詳見 `codex/AGENTS.md` 與 `codex/README.md`。

## 遷移現有專案

若專案已有自己的 `.claude/` harness，請依分階段計畫進行：

1. **階段 A — baseline**：快照安裝前的 hook 輸出與測試結果。
2. **階段 B — 並行安裝**：以 `userConfig.review_agents` 指向專案既有 agent 安裝插件。兩套 hook 並行觸發。
3. **階段 C — 探索**：確認 `/agents` 與 `/plugin details dhpk` 顯示預期的元件。
4. **階段 D — hook 對齊**：比對插件側 sentinel 與專案側差異。記錄所有預期內的差異。
5. **階段 E — 切換**：透過 `.claude/settings.local.json`（`"hooks": {}`）停用專案內建 hook；跑回歸測試。
6. **階段 F — 清理**：刪除已由插件提供的專案內檔案；保留專案特定的覆寫。

每個階段都有 rollback gate。刪除任何東西前，先 tag `pre-dhpk-migration`。

## 儲存庫結構

```
dhpk/
├── .claude-plugin/
│   ├── marketplace.json          # 單一條目的 marketplace（plugins[0].source: "./"）
│   └── plugin.json               # 含 userConfig 的插件 manifest
├── agents/                       # 17 個角色 agent（INDEX.md 為導覽用）
├── commands/                     # ~73 個 slash 指令（do、create-dev、codex-*、smart-commit、opsx-apply-resume、matrix-cell-onboard 等）
├── skills/                       # ~57 個核心 skill（adaptive-dev-workflow、codex-*、tool-routing、dhpk-execution-policy、opsx-apply-resume 配套等）
├── templates/                    # hook 引導用範本（graduation-candidates.md — 首次 graduation 執行時複製到 .claude/artifacts/）
├── modules/                      # 21 個可選用的技術棧模組
│   ├── php-5.6/, php-7.4/, php-8.x/        # {module.yaml, skills/, references/, hooks/（僅 php-7.4）}
│   ├── yii-1.1/                            # Yii 1.1 框架
│   ├── phpunit-5.7/, phpunit-9/, phpunit-10/, phpunit-11/
│   ├── laravel-6/ … laravel-11/            # 每個主版本一個
│   ├── js/{module.yaml, hooks/, skills/, commands/, references/}
│   ├── library-author/{module.yaml, agents/, skills/, hooks/, references/}
│   └── swift/, swiftui/, ios-platform/, swift-testing/, xcode-tooling/  # iOS/Swift 套件（xcode-tooling 另含 hooks/ 與 skill 腳本）
├── hooks/hooks.json              # PreToolUse / PostToolUse / SessionStart / Stop 連線設定
├── scripts/
│   ├── hooks/                    # 核心 hook，含 post-edit-dispatch.sh、pre-bash-dispatch.sh、reap-stale-sentinels.sh、_lib/{payload,portable-sed}.sh
│   ├── statusline/statusline.sh
│   ├── codemaps/、lib/、opsx-apply-resume/、validate/
│   └── （harness-audit、precommit-runner、verify-runner、gemini-adapt-agents、dep-audit）
├── docs/
│   ├── hook-extension.md         # wrapper-dispatch 契約 + 模組 hook 撰寫指南
│   ├── recommended-permissions.md
│   ├── docker-setup.md、subagent-prompt-template.md
├── codex/                        # Codex CLI 雙軌（Claude Code 不會自動載入）
│   ├── AGENTS.md                 # Codex 專屬指引
│   ├── README.md                 # 如何同步進專案
│   ├── skills/、agents/、config.toml.example
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
