# 參數設定參考

> **語言**: [English](./configuration.md) · **繁體中文**

dhpk 在 `.claude-plugin/plugin.json` 中暴露 **74 個 active `userConfig` 旋鈕**。本頁完整記錄每個旋鈕：在哪裡設定、可接受哪些值、實際會改變什麼。平台安裝路徑與支援 status 請見[平台安裝 SSOT](./platform-installation.zh-TW.md)；日常操作流程（安裝、常見工作流、review 循環）請見 [`docs/basic-operations.zh-TW.md`](./basic-operations.zh-TW.md)。如果你不確定要先呼叫哪個技能/指令，先看 [技能與 Slash Command 快速速查（非專業版）](./skill-command-cheat-sheet.zh-TW.md)。

`manifests/install-profiles.json` 的 `common` collection 是唯一主要安裝預設。
舊 `minimal`、`full` 與 `compat-v1` 選擇只保留作為歷史 receipt metadata，不是
發布選項。Module preset 仍是獨立設定。Host 選擇與 receipt 規則請見
[`docs/platform-installation.zh-TW.md`](./platform-installation.zh-TW.md)。

## 在哪裡設定

一個旋鈕的值可能來自三個地方，優先序由低到高：

1. **Plugin 預設值** — 內建於 `.claude-plugin/plugin.json`，若你從未動過該旋鈕就套用此值。
2. **安裝時 `--config`** — 安裝時一次設定，存為 plugin 的全域設定：
   ```bash
   claude plugin install dhpk@dhpk \
     --config modules=php-8.x,laravel-11,phpunit-11,library-author \
     --config docker_containers=php-fpm,mysql \
     --config hook_profile=standard
   ```
   多值型旋鈕（下表標示 `multiple: true` 者）以逗號分隔清單傳入。
3. **專案層級覆寫** — consuming 專案的 `.claude/settings.local.json`（或 `settings.json`）可針對特定旋鈕做逐專案覆寫：
   ```json
   {
     "pluginConfigs": {
       "dhpk@dhpk": {
         "options": {
           "modules": ["php-7.4", "laravel-10"]
         }
       }
     }
   }
   ```
   官方文件明確確認 `modules` 支援此覆寫（讓單台開發機能同時服務不同技術棧的多個專案）——由於 `pluginConfigs.dhpk@dhpk.options.<key>` 是通用的 plugin 設定覆寫機制、並非 `modules` 專屬，同一路徑原則上適用於任何旋鈕。

隨時可在 Claude Code 內重新設定或檢視生效中的設定：

```text
/dhpk:setup           # 重跑同一份安裝問答
/dhpk:setup --show    # 印出目前生效設定
```

部分布林/模式類旋鈕額外支援**單次環境變數覆寫**（僅限當次 session）——見下表「Env 覆寫」欄。

持續性 dispatch-config 解析層為 project > global > environment。`auto` 的有效值來自已知 Host
Profile 該 Role 的 `role_defaults`。共用 delegated-dispatch 設定只適用於
支援該 dispatch role 的入口；Flow Drive 本身只接受 task 與唯讀 `--help`，
沒有 worker、reasoner、planner 或 provider selector。

### Provider-neutral 派發設定

canonical 派發設定分開表示 Host、Target Agent、Provider、Model、Role、Effort 與
Transport。公開 target 格式為 `agent/model[:effort]`，四個 canonical keys 為
`worker_target`、`reasoner_target`、`planner_target`、`reviewer_target`。不可只給裸 Model 名稱。
`auto` 會依目前 Host-native target 選取；`preference_order` 只在 Host policy
與明確的 `cross_provider` opt-in 都允許時才會採用外部候選。

| Key | 型別 | 預設值 | 用途 |
|-----|------|--------|------|
| `worker_target` | string | `auto` | `worker` Role 的 Provider-scoped target。 |
| `reasoner_target` | string | `auto` | 唯讀 `reasoner` Role 的 Provider-scoped target。 |
| `planner_target` | string | `auto` | 唯讀 `planner` Role 的 Provider-scoped target。 |
| `reviewer_target` | string | `auto` | 唯讀 `reviewer` Role 的 Provider-scoped target。 |
| `preference_order` | string[] | `[]` | 自動解析時的 Provider 或 Provider/Model 順序。 |
| `fallback_allow` | boolean | `true` | 只允許 side effect 前已確認的 availability failure fallback。 |

dispatch resolver 層為 project > global > environment。`auto` 使用已知 Host／Role
profile 預設值。欄位無效時只將該欄位標為
`BLOCKED`，不會污染其他設定。diagnostics 分開記錄 catalog support、Host
access、runtime availability 與 fallback permission；靜態 catalog 或 package
discovery 絕不是 runtime proof。舊的 `fast_worker_*`、`*_model`、`*_effort`
與 Provider-specific Model key 已移除（見 [0.69.0 移除的設定](#0690-移除的設定)）；
`<role>_target` 是唯一的公開 Role 權威。`scripts/hooks/session-start.sh` 只在明確
非預設 canonical target（或 `DHPK_DISPATCH_CONFIG_REPORT=1`）時發出條件式
設定報告，不會套用原生 Agent model override。沒有 diagnostics 時，報告是
最多 300 字元的一行摘要，完整 JSON 寫入
`.claude/artifacts/sessions/dispatch-config.json`；有 diagnostics 時直接輸出
完整 JSON。

## 核心派發與 Review

Planner consult scope 屬於明確請求的 planner handoff。Orchestrator 依 brief
中的具名證據選擇 `auto`、`bounded` 或 `discovery`；Flow Drive 沒有 planner
option。Scope selection 不會改變已設定的 planner model、effort 或 work mode。範圍預算見
[基本操作](./basic-operations.zh-TW.md)，選擇規則見
[execution policy](../rules/execution-policy.md#planner-consult-scope)。

| Key | 型別 | 預設值 | 選項 | 用途 |
|-----|------|--------|------|------|
| `hook_profile` | string | `standard` | `minimal` \| `standard` \| `strict` | Hook 輸出的詳細程度。`minimal` 抑制 Stop 提醒；`strict` 增加額外警告。 |
| `review_agents` | string[] | `["code-reviewer","database-reviewer","security-reviewer","frontend-reviewer","doc-reviewer","polyfill-reviewer","migration-reviewer"]` | 任意 7 個 agent 名稱 | 依 role 順序（code、db、sec、frontend、doc、polyfill、migration）由建議性 reviewer 派工使用的 agent。可覆寫指向專案特定的 agent 名稱；較短的覆寫會以預設值補齊其餘 role。Slot 5–6（polyfill、migration）僅在 opt-in trigger 時選取。 |
| `codex_worker_timeout_secs` | string | `360` | 整數秒數 `>= 0`；`0` 停用 | 規範角色 `codex-worker` 專用 dispatcher deadline。同一 scope 內優先於 shared 值；專案值優先於全域值。 |
| `codex_reasoner_timeout_secs` | string | `360` | 整數秒數 `>= 0`；`0` 停用 | 規範角色 `codex-reasoner` 專用 dispatcher deadline。同一 scope 內優先於 shared 值；專案值優先於全域值。值格式錯誤時 fail closed。 |
| `codex_reviewer_timeout_secs` | string | `360` | 整數秒數 `>= 0`；`0` 停用 | 規範角色 `codex-reviewer` 專用 dispatcher deadline。同一 scope 內優先於 shared 值；專案值優先於全域值。 |
| `codex_timeout_secs` | string | `360` | 整數秒數 `>= 0`；`0` 停用 | 所有 Codex CLI 角色共用的 dispatcher deadline。優先序為專案 role-specific > 專案 shared > 全域 role-specific > 全域 shared > 出廠預設；值格式錯誤時在派發前 fail closed。解析後的值會寫入 immutable transport context，wrapper 不會從環境讀取它。 |
| `orchestration_dispatch` | string | `on` | `on` \| `off` | Implementation dispatch 分派表中 delegated implementation routing 的關閉開關。`on` 時適用的實作階段委派工作依決策表路由，並禁止用 `general-purpose` 執行實作。`off` 還原內聯實作並移除 dispatch 指示；適用的 verification gates 仍有效，planner 是否適用依缺少的 outcome 或明確 consult request 決定，不依 task count。Flow Drive 的 native task entry 沒有 dispatch mode。 |
| `cross_provider` | boolean | `false` | `true` \| `false` | 自動 worker 選擇時開放外部候選的 opt-in。`false` 讓 `auto` 僅使用 native 並禁止外部探查；`true` 才檢查宣告的跨 Agent fallback 候選。明確的 `--target <agent>/<model>` 仍是定向選取，不會連帶開放其他 provider。 |
| `subagent_quality_gate` | string | `off` | `on` \| `off` | 僅對明確註冊的 reviewer quality advisory 啟用 `scripts/hooks/subagent-stop-quality.sh`。當 reviewer 的最終回報過於單薄、只是空泛的核准、未附下一步建議的未解錯誤、或缺乏證據的 review 型回覆時，會攔截並要求續答一次；界線固定為一次修正重試，之後改派其他 reviewer，或留下附理由的 unresolved obligation。預設 `off`（無作用，不做啟發式評估）。 |

### 跨家派發 opt-in

要對單一專案 opt-in，請在 `.claude/settings.local.json`（或 project
`settings.json`）的 `pluginConfigs.dhpk@dhpk.options` 下加入設定。共用
automatic selection policy 只適用於支援的 delegated-dispatch 入口，不會改變
Flow Drive 的 task-only native entry，也不取代其他 dispatch 設定的 project >
global > environment 解析層。將 project 值設為 `false` 可回到
native-only automatic selection；移除 project override 則會重新暴露 installed-user
值，因此只有在該值也未設定或為 `false` 時，才能把移除視為 rollback。已退休的
`CODEX=on` 與 `--codex` 不是遷移 alias。

共用 CLI dispatcher 在建立 `0600` immutable transport context 前，會將解析後的 deadline 驗證為無號十進位秒數。空值、小數、負數或其他格式錯誤會阻擋該次派發，不會靜默退回 `360`；只有不需要 CLI transport deadline 時才明確設定 `0`。Python transport 會強制執行已證明的 deadline，並寫入 contained terminal receipt。agy 的獨立設定也同樣是已證明的 dispatch input。

## 0.69.0 移除的設定

下列 key 不再設定派工。project、global 或 environment 設定中出現已移除的 key
時，SessionStart 的 `[session-start] dispatch config:` 摘要會回報 `BLOCKED`
（含 layer、key、replacement），其值不會被套用；同一設定中的 canonical key 仍照常解析。
權威來源：`scripts/lib/dispatch-config.js` 的 `REMOVED_KEYS`。

| 已移除的 key | 改用 |
|---|---|
| `fast_worker_backend` | `worker_target` |
| `fast_worker_backend_order` | `preference_order` |
| `fast_worker_fallback` | `fallback_allow` |
| `fast_worker_model` | `worker_target` |
| `fast_worker_effort` | `worker_target` |
| `deep_reasoner_model` | `reasoner_target` |
| `deep_reasoner_effort` | `reasoner_target` |
| `planner_model` | `planner_target` |
| `planner_effort` | `planner_target` |
| `reviewer_model` | `reviewer_target` |
| `reviewer_effort` | `reviewer_target` |
| `codex_worker_model` | `worker_target` |
| `codex_fast_worker_model` | `worker_target` |
| `codex_worker_effort` | `worker_target` |
| `codex_fast_worker_effort` | `worker_target` |
| `agy_worker_model` | `worker_target` |
| `agy_fast_worker_model` | `worker_target` |
| `codex_reasoner_model` | `reasoner_target` |
| `codex_reasoner_effort` | `reasoner_target` |
| `codex_deep_reasoner_model` | `reasoner_target` |
| `codex_deep_reasoner_effort` | `reasoner_target` |
| `codex_reviewer_model` | `reviewer_target` |
| `codex_reviewer_effort` | `reviewer_target` |
| `codex_fast_worker_timeout_secs` | `codex_worker_timeout_secs` |
| `codex_deep_reasoner_timeout_secs` | `codex_reasoner_timeout_secs` |
| `codex_bridge_timeout_secs` | `codex_reviewer_timeout_secs` |
| `architect_model` | `reasoner_target` |
| `architect_effort` | `reasoner_target` |

`architect_model` 與 `architect_effort` 本來就沒有派工效果，對應到
`reasoner_target` 僅作為遷移提示。Codex 與 agy Role Agent 的 model／effort
取自對應的 `<role>_target`（其 target Agent 為該 CLI 時）；只有
`codex_*_timeout_secs` 仍是各角色專屬。Worker 選擇依 Host 的 `role_defaults`；
單次 invocation 的 selector 是 `--target`，無法偵測 Host 時為 `BLOCKED`。

<a id="codex-mcp-dependency-not-a-userconfig-knob"></a>
<a id="codex-mcp-依賴並非-userconfig-旋鈕"></a>

## Codex 整合與已退休的 MCP 歷史（並非 `userConfig` 旋鈕）

目前 dhpk capability 使用 in-process model 或明確指定的 CLI backend。沒有任何
active skill 或 command 需要 Codex MCP server。現行 CLI-only review path 是
`change-verdict --mode code --backend cli`；同族 CLI role 為
`codex-worker`、`codex-reasoner`、`codex-reviewer`，使用共用 CLI-dispatch
support closure。Flow Drive 不暴露這些 role selector。需要 Codex CLI transport
時，請走支援的 delegated dispatch route，或明確使用 `codex exec` 第二意見。

### 歷史：Codex MCP server（已退休）

Codex CLI 過去透過 `codex mcp-server` 提供 stdio Model Context Protocol server。
Claude Code 會把兩個工具顯示為 `mcp__codex__codex` 與
`mcp__codex__codex-reply`。過去的註冊方式是
`claude mcp add --transport stdio codex -- codex mcp-server`，再以 `/mcp` 與
`claude mcp list` 檢查連線。本段與該指令只為 migration diagnosis 保留；server
已退休，目前任何 dhpk skill 或 command 都不需要、也不建議使用它，不能把它加回
成 hidden fallback。

舊 MCP path 可在多次呼叫間保留 reply thread。遷移後的 owner 改用 current model、
isolated reviewer 或明確選取的 `codex exec`；capability-parity matrix
（[capability-parity matrix](./codex-mcp-capability-parity.md)）
記錄各 capability 的 continuity 差異、驗證證據與 rollback。若需 rollback，請 pin
仍帶有 MCP grant 的最後相容 release；不要在目前 release 重新引入該 transport。

### 目前的外部 app-server plugin

`openai/codex-plugin-cc`（透過 `/plugin install codex@openai-codex` 安裝）是獨立、
選用的整合。它透過自己的 broker script 驅動 Codex CLI 的 `app-server` 子指令，
提供 `/codex:*` 指令、`codex-rescue`、背景輪詢、resume/transfer 與選用 Stop-hook
gate；不會註冊已退休的 MCP server，也不是任何 dhpk capability 的必要條件。

目前支援的 surface 彼此獨立：

| Surface | 如何取得 | 提供內容 | dhpk 依賴 |
|---|---|---|---|
| Codex CLI | 安裝並登入 `codex` 執行檔 | `codex exec`、CLI-backed role，以及 `change-verdict --mode code --backend cli` | 選用；不需要 MCP server |
| `openai/codex-plugin-cc` | `/plugin install codex@openai-codex` | `/codex:*` 指令與 app-server collaboration | 選用的外部 plugin |
| 已退休 Codex MCP | 歷史上的 `codex mcp-server` 註冊 | `mcp__codex__codex` / `mcp__codex__codex-reply` | 無；只保留歷史說明 |

獨立 Codex CLI 雙軌同步（`install-codex-skills.sh`，見
docs/basic-operations.zh-TW.md）也與已退休的 MCP 機制
無關，不需要 server 註冊。

`CODEX=on` 與 `/dhpk:do --codex` 曾是單次 session 的 legacy MCP-peer interface。
兩者現在都已移除，不是持久化的 `userConfig` 值，也不會靜默重新解讀成
`codex exec`、`--worker=codex`、`--reasoner=codex/<model>[:<effort>]` 或外部 plugin。裸值
`--reasoner=codex` 是相容性 shorthand。請用 `$flow-drive` 以 current Host
執行 task；需要 CLI role 時走支援的 delegated route，並以具名 `codex exec`
opt-in 請求第二意見。

### Codex agent 角色（雙軌同步）

這裡講的是獨立的 Codex CLI 雙軌同步（`codex/agents/` → `.codex/agents/`），與已退休的 MCP 機制無關。每個 `codex/agents/*.toml` 檔案都必須宣告非空的 `name`、`description`、`model`、`model_reasoning_effort`、`developer_instructions`；Codex agent 定義只使用 TOML。dhpk 依 Codex 文件中的 project-local discovery path 發布這些檔案，Project-local installer 即使讓 skill 使用 symlink，也一律把 agent TOML materialize 為實體檔。15 個產生出來的角色（`architect`、`code-reviewer`、`security-reviewer`、`database-reviewer`、`tdd-guide`、`deep-reasoner`、`doc-reviewer`、`planner`、`frontend-reviewer`、`migration-reviewer`、`e2e-runner`、`qa-executor`、`docs-writer`，以及 Codex 專用的 `ui-verifier`、`scoped-worker`）是由 `scripts/gen-codex-agents.js` 從 `agents/<name>.md` 或 `codex/agent-sources/<name>.md` 產生，加上 4 個手動維護的通用角色（`explorer`、`worker`、`monitor`、`bug-investigator`），總共 19 個 direct role。

`config.toml.example` 裡的 `[agents.<name>]` 區塊是選用 metadata，不是 runtime registry failure 的 workaround。現行支援的頂層並發設定是 `max_concurrent_threads_per_session`；範例也記錄有效的預設 subagent model 與 reasoning effort。靜態 metadata、實體 TOML 或內建 `explorer` 成功都不能證明 custom role 可派發；必須觀測到非內建 role 的真實 spawn 與 targeted wait。診斷見 [`codex/guidance.md`](../codex/guidance.md)，證據邊界見 [`platform-installation.zh-TW.md`](platform-installation.zh-TW.md)。

## Docker 與技術棧模組

| Key | 型別 | 預設值 | 選項 | 用途 |
|-----|------|--------|------|------|
| `docker_containers` | string[] | `[]` | container 名稱 | 保留給明確註冊的 Docker tooling；預設 SessionStart 不會檢查 container 或輸出 container 變數。 |
| `modules` | string[] | `[]` | 任一內附模組 | 啟用技術棧模組。SessionStart 驗證 `requires:` 並回報啟用模組；模組選擇會影響 reviewer trigger 與合併 Bash/pre-commit gate。post-edit lint/format/Stop 工作不在預設 lifecycle 中。 |

## Review 觸發與風險啟發式

| Key | 型別 | 預設值 | 選項 | 用途 |
|-----|------|--------|------|------|
| `review_trigger_extra_paths` | string[] | `[]` | `<slot>:<prefix>`，slot ∈ `code\|db\|sec\|fe\|doc\|mig` | 各 reviewer slot 的額外路徑前綴，例如 `code:protected/`、`fe:resources/views/`、`mig:db/migrate/`。 |
| `hot_tables` | string[] | `[]` | 表名，例如 `orders`、`order_lines`、`inventory` | 專案特定的高流量資料表名稱，`performance-analyzer` 與 `migration-reviewer` 會視為高風險（大型 ALTER 停機、N+1、缺複合索引）。內附 agent 僅附 POS 系統範例；請在此宣告你專案的真實熱表（或寫入 `CLAUDE.md` / `.claude/rules/`）。留空則退回通用啟發式。 |

## Git 安全閘門

| Key | 型別 | 預設值 | 選項 | Env 覆寫 | 用途 |
|-----|------|--------|------|----------|------|
| `sentinel_commit_gate` | string | `warn` | `warn` \| `block` \| `off` | `DHPK_SENTINEL_COMMIT_GATE` | 保留的 legacy 設定；reviewer 派工為建議性質。`warn` = stderr 提醒（exit 0）；`block` = 拒絕該工具呼叫（exit 2）；`off` = 靜默。 |
| `branch_safety` | string | `warn` | `warn` \| `block` \| `off` | `DHPK_BRANCH_SAFETY` | 在受保護分支上執行破壞歷史的 git 動詞（`commit/merge/rebase/cherry-pick/reset/push`）時的行為。 |
| `protected_branches` | string[] | `["main","master","develop","release/*","hotfix/*"]` | 分支名稱／bash `case` glob | — | `branch_safety` 閘門檢查的分支清單。設為 `[]` 可在不將 `branch_safety` 設為 `off` 的情況下停用逐分支檢查。 |

## Session 行為與提示

| Key | 型別 | 預設值 | Env 覆寫 | 用途 |
|-----|------|--------|----------|------|
| `skill_hint_enabled` | boolean | `true` | `DHPK_DISABLE_SKILL_HINT=1` | 保留給明確註冊的 UserPromptSubmit hint；預設 hook 不會使用。 |
| `learning_db_enabled` | boolean | `false` | `DHPK_LEARNING_DB=1/0` | 保留給明確註冊的 learning observation/presentation；預設 SessionStart 不會注入 learned context。 |
| `graduation_scan_enabled` | boolean | `false` | `DHPK_GRADUATION_SCAN=1/0` | 保留給明確註冊的 Stop advisory；預設 Stop hook 不會使用。 |
| `completion_evidence_enabled` | boolean | `false` | `DHPK_COMPLETION_EVIDENCE=1/0` | 保留給明確註冊的 Stop advisory；預設 Stop hook 不會使用。 |
| `agent_warmstart_enabled` | boolean | `false` | `DHPK_AGENT_WARMSTART=1/0` | 保留給明確註冊的 `Task`/`Agent` prompt injection；預設 lifecycle 不會使用。 |
| `reap_stale_mcp_processes` | boolean | `false` | — | 保留給明確註冊的 SessionEnd/process tooling；預設 SessionStart 不會 reap process。 |
| `harness_restore_hint` | string | `""` | — | 保留給明確註冊的 symlink-health advice；預設 SessionStart 不會輸出它。 |

## Manifest／lockfile 同步

| Key | 型別 | 預設值 | 選項 | 用途 |
|-----|------|--------|------|------|
| `lockfile_sync_commands` | string[] | `[]` | `<manifest>:<command>`，指令不可含逗號 | 保留給明確註冊的 manifest/lockfile advisory tooling；預設不再有 PostToolUse reviewer routing。 |

## `js` 模組

| Key | 型別 | 預設值 | 用途 |
|-----|------|--------|------|
| `js_lint_script` | string | `"lint"` | `js` 模組 pre-commit gate 執行的 npm script 名稱。可覆寫非標準名稱（例如 `lint:strict`）。 |
| `js_typecheck_script` | string | `"typecheck"` | `js` 模組 pre-commit gate 執行的 npm script 名稱。 |
| `js_check_path` | string | `"js/"` | `/ts-check-status` 掃描 `// @ts-check` 推進度時的路徑。可覆寫給 JS 放在 `src/` 或 `app/javascript/` 下的專案。 |
| `js_frontend_roots` | string[] | `[]` | `js` 模組 tier 偵測的專案覆寫——掃描第一方 JS/TS 的根目錄。留空回退 `modules/js/module.yaml`（預設 `[js, src]`）。 |
| `js_core_files` | string[] | `[]` | 專案覆寫——frontend root 下屬於第一方 entry bundle（受 lint）而非 vendor 的 basename，例如 `["app.js","main.js"]`。留空回退 `module.yaml`。 |
| `js_vendor_globs` | string[] | `[]` | 專案覆寫——視為 vendored（任何深度都跳過 lint）的 glob 路徑前綴，例如 `js/ckeditor/`、`js/jquery-*`。glob 不可含逗號。留空回退 `module.yaml`。 |

## `python` 模組

| Key | 型別 | 預設值 | 選項 | 用途 |
|-----|------|--------|------|------|
| `python_project_roots` | string[] | `[]` | 子目錄路徑，例如 `backend` | python 模組 hook 應該 lint 的、含 `pyproject.toml` 的子目錄。預設留空——hook 會從編輯的檔案向上尋找最近的 `pyproject.toml`（已能處理 monorepo 後端）。僅在需要**限制** lint 範圍到特定子樹時才設定此值。 |
| `python_runner` | string | `"uv run"` | 例如 `"poetry run"`、`""` | 在專案環境內呼叫 ruff / pyright / mypy 的指令前綴。`""` 代表直接以 PATH 上的工具執行（已啟用的 venv）。runner 執行檔不存在時退回 bare PATH 工具，若那也不存在則自動跳過。 |
| `ruff_bin` | string | `"ruff"` | — | 由明確註冊的 lint workflow 與適用的 pre-commit 驗證呼叫的 ruff 執行檔。 |
| `python_typechecker` | string | `"pyright"` | `pyright` \| `mypy` \| `none` | pre-commit gate 對已 staged 的 `.py` 檔案執行的型別檢查器。`none` 完全跳過型別檢查。 |
| `pyright_bin` | string | `"pyright"` | — | `python_typechecker=pyright` 時使用的 pyright 執行檔。 |
| `mypy_bin` | string | `"mypy"` | — | `python_typechecker=mypy` 時使用的 mypy 執行檔。 |

## `php-5.6` / `php-7.4` 模組

| Key | 型別 | 預設值 | 用途 |
|-----|------|--------|------|
| `php_bin` | string | `"php"` | 由明確註冊的 `php-5.6` 語法檢查 workflow 使用的 PHP 執行檔／wrapper，例如 `docker exec -i my_php php`。第一個 word 不在 PATH 時自動跳過。 |
| `php_cs_fixer_bin` | string | `"vendor/bin/php-cs-fixer"` | 由明確註冊的 `php-7.4` formatter workflow 與其適用 pre-commit gate 使用的執行檔。 |
| `phpstan_bin` | string | `"vendor/bin/phpstan"` | `php-7.4` 模組 pre-commit gate 使用的 PHPStan 執行檔；僅在 `phpstan.neon[.dist]` 存在時呼叫。 |
| `psalm_bin` | string | `"vendor/bin/psalm"` | `php-7.4` 模組 pre-commit gate 使用的 Psalm 執行檔；僅在 `psalm.xml[.dist]` 存在時呼叫。 |

## iOS / Swift 套件（`xcode-tooling` 模組）

| Key | 型別 | 預設值 | 選項 | 用途 |
|-----|------|--------|------|------|
| `swiftlint_bin` | string | `"swiftlint"` | — | 明確註冊的 `xcode-tooling` SwiftLint workflow 使用的執行檔。不存在時自動跳過。 |
| `xcode_scheme` | string | `""` | scheme 名稱，例如 `babylon` | `xcode-tooling` pre-commit build gate 使用的 scheme。留空則完全跳過 gate（不猜測 scheme）。 |
| `xcode_destination` | string | `""` | 例如 `platform=iOS Simulator,name=iPhone 17` | pre-commit gate *測試*步驟使用的 `-destination`。*build* 步驟一律使用不含裝置名稱的 generic destination，因此永遠不會過期。留空則自動挑選第一個可用模擬器。 |
| `swift_build_skip_tests` | boolean | `false` | — | 設 `true` 時，Swift pre-commit gate 只 build、不跑測試（無 `xcodebuild test` / `swift test`）。 |

## 範例組合

```bash
# 以預設值純安裝（7-slot 預設 agent 名稱）。
claude plugin install dhpk@dhpk

# 舊版 PHP/Yii + JS 全端專案。
claude plugin install dhpk@dhpk \
  --config modules=php-5.6,yii-1.1,phpunit-5.7,js \
  --config docker_containers=php-fpm,mysql \
  --config review_agents=code-reviewer-myproj,db-reviewer-myproj,sec-reviewer-myproj,fe-reviewer-myproj,doc-reviewer-myproj

# 橫跨 Laravel 6-11 的現代 PHP 套件函式庫（含 polyfill review）。
claude plugin install dhpk@dhpk \
  --config modules=php-7.4,php-8.x,laravel-6,laravel-11,phpunit-9,library-author

# 使用 Poetry 而非 uv、mypy 而非 pyright 的 Python/FastAPI 專案。
claude plugin install dhpk@dhpk \
  --config modules=python,fastapi,pytest \
  --config python_runner="poetry run" \
  --config python_typechecker=mypy
```

精選的模組組合請見 `manifests/install-profiles.json`；完整技術棧／版本目錄（SSOT）請見 `manifests/module-catalog.json`。

共用 delegated-dispatch 設定只適用於支援的 caller。Flow Drive 僅接受 task
與唯讀 `--help`，沒有 worker、reasoner、cross-provider、planner、architect
或 runner options。外部 delegated target 在 probe/launch 前仍須當前 Host grant。
standalone bridge 已於 0.66.2 退休。
