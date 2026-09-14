# Codex 專案自訂角色無法派發 — 根因調查

- 調查日期：2026-08-31
- 對象：Codex CLI 0.151.0 / dhpk `.codex/agents/*.toml` 專案角色
- 交接來源：`/tmp/dhpk-codex-registry-retro-handoff-20260831.md`
- 狀態：**根因已確認（Phase 3 trust 前置條件 + Phase 4 rollout 證據面，含 red 重現與 green 對照）**

## Phase 1 — 問題釐清

- 症狀：派發專案自訂角色時 Codex 回 `unknown agent_type '<role>'`。
- 先前分類：`CUSTOM_AGENT_REGISTRY_UNAVAILABLE`，並被視為疑似 Codex CLI 上游缺陷。
- 先前已排除：hyphen/underscore 命名、symlink/ELOOP、實體 TOML 缺漏、GPT-5.6 模型別名。
- 環境要點：本機生效的 `CODEX_HOME` 是
  `/home/paul/.config/orca/codex-accounts/<account-id>/home`（Orca 設定），**不是** `~/.codex`。
  該 home 沒有 `agents/` 目錄，config 也沒有任何 `[agents.<name>]` 角色表；
  角色唯一來源就是專案的 `.codex/agents/`。

## Phase 2 — 證據蒐集

### 觀測手段

1. **零成本目錄掃描偵測器**：放入缺欄位的角色檔，Codex 啟動時會印
   `warning: Ignoring malformed agent role definition: ...`；有無此警告即可判定目錄是否被掃描。
2. **註冊表直讀**：直接詢問 session「`spawn_agent` 的 schema 是否有 `agent_type` 參數、
   允許值為何」。這比 spawn 成功與否更接近真因，因為註冊表為空時該參數會整個消失。

### binary 靜態證據

`core/src/agent/role.rs` 附近同時出現 `unknown agent_type '`、
`agent type is currently not available`、`No corresponding config content`，
以及內建的 `explorer.toml` / `awaiter.toml`。角色 schema 欄位為
`developer_instructions`、`model`、`model_reasoning_effort`、`model_reasoning_summary`、
`personality`、`service_tier`、`skills`、`default`；`description` 與
`developer_instructions` 為必填（由 malformed 警告文字證實）。

`codex features list`：`multi_agent` 與 `multi_agent_v2` 皆為 stable/true——非 feature flag 問題。

## Phase 3 — 根因確認

### 決定性矩陣

同一個 repo（`/home/paul/projects/dhpk`，內含 16 個實體角色 TOML）、
同一個一次性 `CODEX_HOME`（僅含 `auth.json` symlink 與一份最小 config），
每格只改一個變因：

| # | 一次性 home 的 config | 旗標 | `spawn_agent.agent_type` |
|---|---|---|---|
| 1 | `[projects."/home/paul/projects/dhpk"] trust_level = "trusted"` | `--strict-config` | **存在，列出全部 16 個 dhpk 角色 + `default`** |
| 2 | 同 #1 | `--ignore-user-config --strict-config` | **不存在** |
| 3 | 無 `[projects]` 區塊 | `--strict-config` | **不存在** |

補充（一次性 home、專案內放入壞角色檔的掃描偵測器）：
`[agents] enabled=true` + `[features.multi_agent_v2] enabled=true` 但**無 trust** → 未掃描；
**僅有 trust** → 已掃描。即 `agents.enabled` / `multi_agent*` 對探索與否無影響，
決定性條件是 trust。

在 `--ignore-user-config` 下，額外用 `-c agents.enabled=true`、
`-c features.multi_agent=true`、`-c features.multi_agent_v2.enabled=true`、
`-c 'projects."...".trust_level="trusted"'` 逐一補救，`agent_type` 仍然不存在——
`--ignore-user-config` 會整體關閉專案角色來源，無法用 `-c` 覆寫救回。

### 根因

> Codex CLI 0.151.0 僅在**同時滿足**下列兩個條件時，才會把專案本地
> `.codex/agents/*.toml` 註冊進 `spawn_agent` 的 `agent_type` 列舉：
> (a) 專案目錄在生效的 `$CODEX_HOME/config.toml` 中被標記為
> `[projects."<絕對路徑>"] trust_level = "trusted"`；
> (b) 未使用 `--ignore-user-config`。
>
> dhpk 的 `codex-sync` consumer gate 安裝到**一次性、未被信任**的專案並以
> `--ignore-user-config --strict-config` 執行，兩個條件皆不滿足，
> 註冊表為空，因而 `unknown agent_type`。

這是 **dhpk consumer gate 的驗證方法學缺陷**，與角色命名、symlink/ELOOP、
materialization、GPT-5.6 模型別名皆無關。

### Green 對照（未受污染）

- 於 dhpk repo（config 第 116 行已信任）不加旗標派發 `doc-reviewer` → 成功回 `PONG`，
  且 session 明確列出 16 個允許的 `agent_type` 值。`doc-reviewer` 從未被放進任何
  home 層 `agents/` 目錄，排除 daemon 快取污染。
- 於一次性 home（僅 trust 記錄）派發同樣成功——證明「trust + 正常載入」即為充分條件。

### False PASS 危害（新發現）

當註冊表為空時，`spawn_agent` 並非必然報錯：模型可能自行降級成
「不帶 `agent_type` 的一般 spawn」並回報「成功」。實測 red 重現中即出現
`spawn_agent does not support an agent_type parameter, so I mapped doc-reviewer to task_name`
卻仍回傳 `PONG`。**任何以文字 PASS/FAIL 或子代理回覆內容為準的 gate 都可能誤判為通過**；
必須斷言 `agent_type` 確實被接受。

## 推翻 / 修正的既有結論

| 既有記載 | 實測 |
|---|---|
| `OPEN / NO-SHIP`：0.151.0 對專案自訂角色回 `unknown agent_type` | 在受信任專案且正常載入設定時**可正常派發全部 16 角色** |
| 分類為 `CUSTOM_AGENT_REGISTRY_UNAVAILABLE`（疑似上游缺陷） | 分類的**成因**錯誤：是 trust + `--ignore-user-config`，非上游缺陷 |
| next action 5：準備上游缺陷回報 | 以「registry unavailable」為框架的回報應撤回 |
| 「with and without the relevant user-config path 都失敗」 | 該切換改變的是使用者設定載入與否，等同本次矩陣的 #2；不是註冊路徑測試 |

保留的低優先觀察：註冊表為空時錯誤訊息為 `unknown agent_type` 而非提示信任問題，
可診斷性不佳，可作為獨立的上游改進建議（非缺陷回報）。

## 官方文件查證（2026-08-31）

來源：OpenAI Codex 官方文件（developers.openai.com/codex）與上游
`TrustLevel` enum（`codex-rs/protocol/src/config_types.rs`）。

### Trust 閘控專案 `.codex/` 是刻意安全設計

官方 [Config basics](https://developers.openai.com/codex/config-basic) 與
[Advanced Configuration](https://developers.openai.com/codex/config-advanced)
明寫：**基於安全，只有 trusted 專案才載入專案層 `.codex/`**。untrusted 時
Codex **忽略 project-scoped `.codex/` layers**，明文例子包含
`.codex/config.toml`、project-local hooks、project-local rules；user / system
層仍載入。

[Configuration Reference](https://developers.openai.com/codex/config-reference)
的 `projects.<path>.trust_level` 同一句話：untrusted 專案 skip project-scoped
`.codex/` layers（config / hooks / rules）。

[Subagents](https://developers.openai.com/codex/subagents) 把
`.codex/agents/` 定義為 **project-scoped** custom agents（對照
`~/.codex/agents/` 為 personal）。官方**沒有**另寫
「`spawn_agent.agent_type` 列舉來自 `.codex/agents/*.toml`、且受 trust 閘控」
這句專用句子。角色探索被閘控，是「專案 `.codex/` layer 整層不載入」的後果，
不是一份獨立的角色註冊表功能說明。dhpk 實測（trust 在 → 16 角色入列舉；
trust 不在或 `--ignore-user-config` → 參數消失）與此文件模型一致。

### `trust_level` 取值

官方 reference 只列兩個字串：`"trusted"` | `"untrusted"`。
上游 enum 同樣只有 `Trusted` / `Untrusted`（serde `lowercase`）。
**沒有**第三個文件化字串值。

源碼裡 `trust_level` 是 `Option`：未寫入時既非 `is_trusted()` 也非
`is_untrusted()`，等於第三種**執行期狀態**（未作信任決定），但官方不把它
當成可設定值。

### `--dangerously-bypass-approvals-and-sandbox` 不是 trust 等價物

[Agent approvals & security](https://developers.openai.com/codex/agent-approvals-security)
把它（別名 `--yolo`）定義為 **關掉 sandbox 與 approval**，與
`trust_level` 分開。官方沒有寫此旗標會載入 untrusted 專案的 `.codex/`
layers。gate 不得拿它代替預寫 `trust_level = "trusted"`。

## 清理與殘留

探針皆在 scratchpad 一次性目錄與一次性 `CODEX_HOME`（auth.json 以 symlink 引用，
未複製憑證）中進行；暫置於真實 `CODEX_HOME/agents/` 與 `~/.codex/agents/` 的探針檔案
已於當次指令刪除，repository 工作樹未因調查而變更。

殘留一項：在新目錄執行 `codex exec` 會自動把該目錄追加為 trusted，
生效 config 第 140 行因此留下一筆指向已刪除 scratchpad 目錄的記錄（無害，未擅自修改使用者設定）。
此行為也說明：一次性 `CODEX_HOME` 下 trust 永遠不會被繼承，gate 必須自行預先寫入。

## Phase 4 — 證據面二次根因（2026-08-31 後續 session）

先前修正探測前置條件（一次性 `CODEX_HOME`、symlink `auth.json`、預寫 trust、
拿掉 `--ignore-user-config`）之後，實機探針仍出現文字標記
`CODEX_DHPK_NAMED_ROLES=PASS`、卻沒有任何 typed `collab_agent_spawn_end` /
`spawn_agent` / `wait` stdout 事件。單變因 live capture（Codex CLI 0.151.0）確認：

- `codex exec --json` stdout **從不**發出 `collab_agent_spawn_end`，也從不發出
  `spawn_agent` 工具的 `collab_tool_call`。這兩個字面量存在於編譯後的 string
  table，但不在此 code path 產出。stdout 上也沒有 tool-registry / `inputSchema`
  探索事件，因此無法用 schema 斷言 `agent_type` 是否被廣告。
- 角色派發本身是成功的。子執行緒自己的 rollout JSONL
  （`session_meta.payload.agent_role`、`parent_thread_id`、固定 `agent_path`
  慣例，加上子檔的 `event_msg` / `task_complete`）才是 typed spawn + 完成證據。
- 該證據只寫進一次性 `CODEX_HOME` 的 `sessions/**/rollout-*.jsonl`，而
  `--ephemeral` 會抑制這層 persistence。gate 因此必須**不**傳 `--ephemeral`，
  並在 `finally` 刪除一次性 home 之前讀取 rollout。

**推論、非已證實事實：** `--ephemeral` 只抑制 rollout *persistence*、不抑制
spawn 本身。兩次 live run（有／無 `--ephemeral`）stdout 相同且都成功 spawn，
與此推論一致，但不構成證明。gate 不論如何都拿掉 `--ephemeral`。

四角色實機證明（`explorer`、`deep-reasoner`、`code-reviewer`、`doc-reviewer`）
改由此 rollout 關聯通過；文字標記仍只是補充，gate 維持 fail-closed。
完整決策見 `openspec/changes/fix-codex-agent-symlink-runtime/design.md`
Decision 6。
