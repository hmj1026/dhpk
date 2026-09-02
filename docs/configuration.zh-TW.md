# 參數設定參考

> **語言**: [English](./configuration.md) · **繁體中文**

dhpk 在 `.claude-plugin/plugin.json` 中暴露 **59 個 `userConfig` 旋鈕**。本頁完整記錄每個旋鈕：在哪裡設定、可接受哪些值、實際會改變什麼。平台安裝路徑與支援 status 請見[平台安裝 SSOT](./platform-installation.zh-TW.md)；日常操作流程（安裝、常見工作流、review 循環）請見 [`docs/basic-operations.zh-TW.md`](./basic-operations.zh-TW.md)。

Claude 的預設 discovery artifact 是由
`manifests/distribution-inventory.json` 產生的實體化 `minimal` profile，並非
直接掃描未過濾的 `skills/` 原始目錄。此 profile 最多發布 15 個
`implicit-eligible` entry；`full` 與 `compat-v1` 是明確 opt-in 的 profile
artifact。Agent Plugin 與 Cursor 的發布 membership 維持不變。profile 選擇與
receipt 規則請見 [`docs/platform-installation.zh-TW.md`](./platform-installation.zh-TW.md)。

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

## 核心派發與 Review

| Key | 型別 | 預設值 | 選項 | 用途 |
|-----|------|--------|------|------|
| `hook_profile` | string | `standard` | `minimal` \| `standard` \| `strict` | Hook 輸出的詳細程度。`minimal` 抑制 Stop 提醒；`strict` 增加額外警告。 |
| `review_agents` | string[] | `["code-reviewer","database-reviewer","security-reviewer","frontend-reviewer","doc-reviewer","polyfill-reviewer","migration-reviewer"]` | 任意 7 個 agent 名稱 | 依 slot 順序（code、db、sec、frontend、doc、polyfill、migration）被 sentinel 提醒呼叫的 agent。可覆寫指向專案特定的 agent 名稱；較短的覆寫會以預設值補齊其餘 slot。Slot 5–6（polyfill、migration）僅在 opt-in 時觸發——polyfill 經由 `library-author` 模組，migration 經由模組 triggers 或 `mig:` 額外路徑。 |
| `deep_reasoner_model` | string | `opus` | `haiku` \| `sonnet` \| `opus`（依當前 Claude Code 版本支援的模型而定） | `dhpk:deep-reasoner` Agent-call 派發（推理密集的實作工作）使用的模型層級。當與 agent frontmatter 預設值不同時，透過 Agent call 的 `model` 參數套用。設定值無效時每個 session 只警告一次並退回 frontmatter 預設值——絕不會讓派發失敗。 |
| `fast_worker_model` | string | `sonnet` | 同上 | `dhpk:fast-worker` Agent-call 派發（機械式實作工作）使用的模型層級。驗證/退回行為與 `deep_reasoner_model` 相同。 |
| `planner_model` | string | `opus` | 同上 | `dhpk:planner` Agent-call 派發使用的模型層級（`/dhpk:do --plan` opt-in 的實作前批判 / 實作後 warm review）。驗證/退回行為與 `deep_reasoner_model` 相同。 |
| `deep_reasoner_effort` | string | `high` | `low` \| `medium` \| `high` \| `xhigh` \| `max`（依當前 Claude Code 版本支援而定） | `dhpk:deep-reasoner` Agent-call 派發使用的推理強度。當與 agent frontmatter 預設值不同時，透過 Agent call 的 `effort` 參數套用。設定值無效時每個 session 只警告一次並退回 frontmatter 預設值——絕不會讓派發失敗。 |
| `fast_worker_effort` | string | `medium` | 同上 | `dhpk:fast-worker` Agent-call 派發使用的推理強度。驗證/退回行為與 `deep_reasoner_effort` 相同；決策層（`deep-reasoner`）用較高強度、執行層（`fast-worker`）降階。 |
| `planner_effort` | string | `high` | 同上 | `dhpk:planner` Agent-call 派發使用的推理強度。驗證/退回行為與 `deep_reasoner_effort` 相同；實作後的 warm review 呼叫會降階為 `medium`。 |
| `codex_worker_model` | string | `gpt-5.6-luna` | codex CLI 接受的任何模型 | 規範角色 `codex-worker` 派發時傳給 codex CLI 後端的模型。依標準分層解析（專案 pluginConfigs > 全域 pluginConfigs > 出廠預設）後傳入 `run-codex.sh`。Codex 模型名稱汰換快速——預設值失效時在此覆寫，而非改原始碼（可用 `codex models` 查詢）。舊別名：`codex_fast_worker_model`。 |
| `codex_worker_effort` | string | `xhigh` | codex CLI 接受的任何強度（如 `low` \| `medium` \| `high` \| `xhigh`） | `codex-worker` 派發時傳給 codex CLI 後端的 `model_reasoning_effort`——強力機械層。舊別名：`codex_fast_worker_effort`。 |
| `codex_worker_timeout_secs` | string | `360` | 整數秒數 `>= 0`；`0` 停用 | 規範角色 `codex-worker` 專用 dispatcher deadline。同一 scope 內優先於 shared 值；專案值優先於全域值。舊別名：`codex_fast_worker_timeout_secs`。 |
| `codex_reasoner_model` | string | `gpt-5.6-sol` | codex CLI 接受的任何模型 | 規範角色 `codex-reasoner` 派發時傳給 codex CLI 後端的模型，透過 `--reasoner=codex` 使用唯讀 sandbox。舊別名：`codex_deep_reasoner_model`。 |
| `codex_reasoner_effort` | string | `high` | codex CLI 接受的任何強度 | `codex-reasoner` 派發時傳給 codex CLI 後端的 `model_reasoning_effort`。舊別名：`codex_deep_reasoner_effort`。 |
| `codex_reasoner_timeout_secs` | string | `360` | 整數秒數 `>= 0`；`0` 停用 | 規範角色 `codex-reasoner` 專用 dispatcher deadline。同一 scope 內優先於 shared 值；專案值優先於全域值。值格式錯誤時 fail closed。舊別名：`codex_deep_reasoner_timeout_secs`。 |
| `codex_reviewer_model` | string | `gpt-5.6-sol` | codex CLI 接受的任何模型 | 規範角色 `codex-reviewer` 派發時傳給 codex CLI 後端的模型（此版本內部只用，無法直接派發）。 |
| `codex_reviewer_effort` | string | `high` | codex CLI 接受的任何強度 | `codex-reviewer` 派發時傳給 codex CLI 後端的 `model_reasoning_effort`。 |
| `codex_reviewer_timeout_secs` | string | `360` | 整數秒數 `>= 0`；`0` 停用 | 規範角色 `codex-reviewer` 專用 dispatcher deadline。同一 scope 內優先於 shared 值；專案值優先於全域值。舊別名：`codex_bridge_timeout_secs`。 |
| `codex_timeout_secs` | string | `360` | 整數秒數 `>= 0`；`0` 停用 | 所有 Codex CLI 角色共用的 dispatcher deadline。優先序為專案 role-specific > 專案 shared > 全域 role-specific > 全域 shared > 出廠預設；值格式錯誤時在派發前 fail closed。解析後的值會寫入 immutable transport context，wrapper 不會從環境讀取它。 |
| `agy_worker_model` | string | `Gemini 3.6 Flash (High)` | `agy models` 列出的任何模型 | 規範角色 `agy-worker` 派發時傳給 agy CLI 後端的模型顯示字串。Agy 將思考強度內建於模型名稱，故無獨立的 effort key。分層方式同上；預設值失效時覆寫（可用 `agy models` 查詢）。舊別名：`agy_fast_worker_model`。 |
| `architect_model` | string | `fable` | 執行中的 Claude Code 支援的模型層級 | `dhpk:architect` Agent-call 派發的模型層級；逐次呼叫套用，不修改 frontmatter；HIGH-risk 架構決策仍可向上升級。 |
| `architect_effort` | string | `low` | `low` \| `medium` \| `high` \| `xhigh` \| `max` | `dhpk:architect` Agent-call 派發的推理強度；逐次呼叫套用，不修改 frontmatter。 |
| `orchestration_dispatch` | string | `on` | `on` \| `off` | Implementation dispatch 分派表中實作 worker/reasoner 路由（`adaptive-dev-workflow` 的 feature/bug mode 與 `opsx-apply-goal`）的關閉開關。`on` 時實作階段工作依決策表路由，並禁止用 `general-purpose` 執行實作。`off` 還原內聯實作並移除 dispatch 指示，但多任務 OpenSpec 的 mandatory planner 與 verification gates 仍然有效。 |
| `fast_worker_backend` | string | `claude` | `claude` \| `codex` \| `agy` \| `auto` | 機械 worker 的確定性選擇器。`claude` 對應 `dhpk:fast-worker`；`auto` 依 `fast_worker_backend_order` 檢查可用性。`/dhpk:do --worker=...` 僅覆寫單次呼叫（旗標 > userConfig > shipped 預設）；無效旗標警告一次後退回此設定／預設，無效設定值則使用 `claude`。Codex CLI 的可用性檢查與已退休的 `CODEX=on` flag 無關；需要 Codex worker 時請明確選 `--worker=codex`。 |
| `fast_worker_backend_order` | string | `claude,codex,agy` | 逗號分隔的 backend 名稱 | 僅供 `auto` 使用的可用性順序；會記錄被拒絕的候選及原因。值無效時每個 session 警告一次並使用 shipped 順序。 |
| `fast_worker_fallback` | string | `none` | `none` \| `claude` | 只允許對明確選取但缺少 CLI 執行檔的情況使用 `claude` 備援。驗證、授權、模型、任務、執行與 verification 失敗都維持 blocked，不得靜默切換。 |
| `subagent_quality_gate` | string | `off` | `on` \| `off` | 僅對 reviewer sentinel subagent 啟用 `scripts/hooks/subagent-stop-quality.sh`。當 reviewer 的最終回報過於單薄、只是空泛的核准、未附下一步建議的未解錯誤、或缺乏證據的 review 型回覆時，會攔截並要求續答一次；此 hook 排在 `subagent-stop-verify.sh` 之前，避免被攔截的 reviewer sentinel 被自動清除。界線固定為一次修正重試，之後改派其他 reviewer，或留下附理由的 pending gate。預設 `off`（無作用，不做啟發式評估）。命中/未命中的擷取結果會記錄到 `.claude/artifacts/sessions/.subagent-stop-quality-extraction.json`。 |

dispatcher 在建立 `0600` immutable transport context 前，會將解析後的 deadline 驗證為無號十進位秒數。空值、小數、負數或其他格式錯誤會阻擋該次派發，不會靜默退回 `360`；只有不需要 portable runner deadline 時才明確設定 `0`。Python transport runner 而非 `timeout`/`gtimeout` 會強制執行已證明的 deadline，並寫入 contained terminal receipt。agy 的獨立設定也同樣是已證明的 dispatch input。

<a id="codex-mcp-dependency-not-a-userconfig-knob"></a>

## Codex 整合與已退休的 MCP 歷史（並非 `userConfig` 旋鈕）

目前 dhpk capability 使用 in-process model 或明確指定的 CLI backend。沒有任何
active skill 或 command 需要 Codex MCP server。現行 CLI-only review path 是
`dhpk-change-review/scripts/review.sh --backend cli`；同族 CLI role 為
`codex-worker`、`codex-reasoner`、`codex-reviewer` 與 `dhpk-codex-bridge`。需要
Codex CLI transport 時，請明確使用 `--worker=codex`、`--reasoner=codex` 或
`codex exec` 第二意見。

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
| Codex CLI | 安裝並登入 `codex` 執行檔 | `codex exec`、CLI-backed role，以及 `dhpk-change-review/scripts/review.sh --backend cli` | 選用；不需要 MCP server |
| `openai/codex-plugin-cc` | `/plugin install codex@openai-codex` | `/codex:*` 指令與 app-server collaboration | 選用的外部 plugin |
| 已退休 Codex MCP | 歷史上的 `codex mcp-server` 註冊 | `mcp__codex__codex` / `mcp__codex__codex-reply` | 無；只保留歷史說明 |

獨立 Codex CLI 雙軌同步（`install-codex-skills.sh`，見
docs/basic-operations.zh-TW.md）也與已退休的 MCP 機制
無關，不需要 server 註冊。

`CODEX=on` 與 `/dhpk:do --codex` 曾是單次 session 的 legacy MCP-peer interface。
兩者現在都已移除，不是持久化的 `userConfig` 值，也不會靜默重新解讀成
`codex exec`、`--worker=codex`、`--reasoner=codex` 或外部 plugin。請用
`/dhpk:do`／`dhpk-implement` 進行 current-model implementation，需要時明確選 CLI
role，並以具名 `codex exec` opt-in 請求第二意見。

### Codex agent 角色（雙軌同步）

這裡講的是獨立的 Codex CLI 雙軌同步（`codex/agents/` → `.codex/agents/`），與已退休的 MCP 機制無關。每個 `codex/agents/*.toml` 檔案都必須宣告非空的 `name`、`description`、`model`、`model_reasoning_effort`、`developer_instructions`；Codex agent 定義只使用 TOML。dhpk 依 Codex 文件中的 project-local discovery path 發布這些檔案，Project-local installer 即使讓 skill 使用 symlink，也一律把 agent TOML materialize 為實體檔。12 個產生出來的角色（`architect`、`code-reviewer`、`security-reviewer`、`database-reviewer`、`tdd-guide`、`deep-reasoner`、`doc-reviewer`、`planner`、`spec-miner`、`frontend-reviewer`、`migration-reviewer`、`e2e-runner`）是由 `scripts/gen-codex-agents.js` 從 `agents/<name>.md` 產生，加上 4 個手動維護的通用角色（`explorer`、`worker`、`monitor`、`bug-investigator`），總共 16 個 direct role。

`config.toml.example` 裡的 `[agents.<name>]` 區塊是選用 metadata，不是 runtime registry failure 的 workaround。現行支援的頂層並發設定是 `max_concurrent_threads_per_session`；範例也記錄有效的預設 subagent model 與 reasoning effort。靜態 metadata、實體 TOML 或內建 `explorer` 成功都不能證明 custom role 可派發；必須觀測到非內建 role 的真實 spawn 與 targeted wait。診斷見 [`codex/AGENTS.md`](../codex/AGENTS.md)，證據邊界見 [`platform-installation.zh-TW.md`](platform-installation.zh-TW.md)。

## Docker 與技術棧模組

| Key | 型別 | 預設值 | 選項 | 用途 |
|-----|------|--------|------|------|
| `docker_containers` | string[] | `[]` | container 名稱 | 保留給明確註冊的 Docker tooling；預設 SessionStart 不會檢查 container 或輸出 container 變數。 |
| `modules` | string[] | `[]` | 任一內附模組 | 啟用技術棧模組。SessionStart 驗證 `requires:` 並回報啟用模組；模組選擇會影響 sentinel routing 與合併 Bash/pre-commit gate。post-edit lint/format/Stop 工作不在預設 lifecycle 中。 |

## Review 觸發與風險啟發式

| Key | 型別 | 預設值 | 選項 | 用途 |
|-----|------|--------|------|------|
| `review_trigger_extra_paths` | string[] | `[]` | `<slot>:<prefix>`，slot ∈ `code\|db\|sec\|fe\|doc\|mig` | 各 reviewer slot 的額外路徑前綴，例如 `code:protected/`、`fe:resources/views/`、`mig:db/migrate/`。 |
| `hot_tables` | string[] | `[]` | 表名，例如 `orders`、`order_lines`、`inventory` | 專案特定的高流量資料表名稱，`performance-analyzer` 與 `migration-reviewer` 會視為高風險（大型 ALTER 停機、N+1、缺複合索引）。內附 agent 僅附 POS 系統範例；請在此宣告你專案的真實熱表（或寫入 `CLAUDE.md` / `.claude/rules/`）。留空則退回通用啟發式。 |

## Git 安全閘門

| Key | 型別 | 預設值 | 選項 | Env 覆寫 | 用途 |
|-----|------|--------|------|----------|------|
| `sentinel_commit_gate` | string | `warn` | `warn` \| `block` \| `off` | `DHPK_SENTINEL_COMMIT_GATE` | reviewer sentinel 存在時執行 `git commit/merge/rebase/cherry-pick` 的行為。`warn` = stderr 提醒（exit 0）；`block` = 拒絕該工具呼叫（exit 2）；`off` = 靜默。與 pre-bash-guard 對 `git push` 的硬性封鎖互補。 |
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
| `lockfile_sync_commands` | string[] | `[]` | `<manifest>:<command>`，指令不可含逗號 | 保留給明確註冊的 manifest/lockfile advisory tooling；預設 PostToolUse 只做 review sentinel routing。 |

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
