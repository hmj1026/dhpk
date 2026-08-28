# dhpk Antigravity CLI (agy) SubAgent 支援與升級指南

本文件旨在說明 Antigravity CLI (`agy`) 對 SubAgent（子代理）的載入機制、現況診斷、差異對照，並提供 `dhpk` 未來完整升級支援 `agy-cli` 外掛安裝的規範與操作流程。

---

## 1. 現況載入診斷與根因分析

### 1.1 現況診斷

在舊版 AGY adapter 尚未轉譯 Frontmatter 時，`agy agents` 曾只識別
`dhpk-agents-index`，其餘 31 個角色 Agent 無法載入；這是歷史 baseline，
不是目前產物的狀態。使用目前的 `plugins/dhpk-agy` 產物與 AGY 1.1.19
驗證時，`agy agents` 可列出 35 個適配後的角色 Agent；但隔離的 harness
runtime probe 仍可能因認證、連線或 CLI loader 能力不足而回報
`UNAVAILABLE`/`SKIP_INCOMPATIBLE`，不能把 discovery 數量當成 runtime PASS。

```bash
$ agy agents
Available agents:
agent-evaluator, agy-fast-worker, architect, ... (35 agents)
```

### 1.2 為什麼 `dhpk-agents-index` 能被載入？

檢視 [`agents/INDEX.md`](../agents/INDEX.md) 的 Frontmatter：
```yaml
---
name: dhpk-agents-index
description: 'Reference index for the agents shipped by the dhpk plugin.'
---
```
舊版的 `INDEX.md` 僅包含基本的 `name` 與 `description`，未包含任何平台專屬的未相容欄位，因此符合 `agy` 的基本解析器規則。

### 1.3 其餘 31 個 Agent 載入失敗的原因

檢視其餘 Agent（例如 [`agents/code-reviewer.md`](../agents/code-reviewer.md)）：
```yaml
---
name: code-reviewer
description: 'Expert code review specialist...'
tools: Read, Grep, Glob, Bash, mcp__gitnexus__impact
model: sonnet
effort: medium
maxTurns: 25
---
```
1. **`model` 名稱不相容**：
   - Claude Code 接受 `sonnet`, `opus`, `haiku`, `fable`。
   - `agy` 的 Subagent 規格僅接受 Enum：`['inherit', 'flash_lite', 'flash', 'pro']`（或省略該欄位預設繼承）。未支援的模型字串會導致整個 Frontmatter 解析失敗。
2. **`tools` 語法與工具名稱不相容**：
   - Claude Code 接受字串清單（例如 `tools: Read, Grep, Glob, Bash`）。
   - `agy` 預期標準 YAML/JSON Array 格式（例如 `tools: ["read_file", "grep_search", "run_command"]`），且工具名稱需對應 Antigravity 內建工具集。
3. **未支援的欄位干擾**：
   - `effort`, `maxTurns`, `color` 等欄位在 `agy` 解析器中若未被轉譯或過濾，會造成載入異常。

---

## 2. Antigravity CLI SubAgent 規範標準

### 2.1 Frontmatter 規格

相容於 `agy` 的 Agent Markdown 格式如下：

```markdown
---
name: agent-unique-name
description: "該 Agent 的職責說明，用於派發與選擇"
tools: [read_file, grep_search, run_command, view_file, write_to_file]
model: pro  # 可選值: inherit | flash_lite | flash | pro
---

# Agent 提示詞與工作流程主體
...
```

### 2.2 跨平台 Model 映射規則

| Claude Code Model | 角色定位 | 建議 AGY Model Enum | 說明 |
| :--- | :--- | :--- | :--- |
| `opus` | 深度推論、架構規劃 | `pro` | 對應 AGY Pro backend / 高階推論 |
| `sonnet` | 程式碼實作、嚴格審查 | `pro` 或 `inherit` | 主力模型，維持高品質輸出 |
| `fable` | 快速架構諮詢 | `flash` 或 `inherit` | 輕量架構評估 |
| `haiku` | 檔案檢索、文件更新、簡單掃描 | `flash` 或 `flash_lite` | 高通量、低成本 |

### 2.3 跨平台 Tools 映射規則

| Claude Code Tool | Antigravity / AGY Tool | 說明 |
| :--- | :--- | :--- |
| `Read` | `view_file` / `read_file` | 檢視與讀取檔案 |
| `Write` | `write_to_file` | 建立或複寫檔案 |
| `Edit` | `replace_file_content` / `multi_replace_file_content` | 區塊取代或多重修改 |
| `Bash` | `run_command` | 執行 Shell 指令 |
| `Grep` | `grep_search` | 正則或關鍵字搜尋 |
| `Glob` | `list_dir` | AGY 1.1.x 的目錄與檔案結構清單工具；不要輸出未註冊的 `glob` alias |
| `WebSearch` | `search_web` | 網路搜尋 |
| `WebFetch` | `read_url_content` | 網頁靜態內容抓取 |
| `Agent` | `invoke_subagent` | 派發子代理 |
| `mcp__<server>__<tool>` | `mcp_<server>_<tool>` | MCP 工具格式正規化 |

---

## 3. dhpk 升級支援改造方案

### 3.1 升級適配轉換腳本 (`scripts/agy-adapt-agents.js`)

改進現有腳本，使其具備完整的 Frontmatter 適配能力：
1. 支援無中括號逗號分隔的 `tools:` 語法解析。
2. 自動將 `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob` 映射至 AGY 內建名稱。
3. 自動將 `model: sonnet/opus` 映射至 `pro`，`haiku` 映射至 `flash_lite`。
4. 移除 `color:`, `effort:`, `maxTurns:` 等 Claude 專屬屬性。

### 3.2 外掛安裝與結構佈局

`dhpk` 外掛安裝至 Antigravity CLI 時，目錄結構應符合標準規範：

```text
~/.gemini/config/plugins/dhpk/
├── plugin.json               # 必須包含 name: "dhpk"
├── mcp_config.json           # optional：MCP 伺服器配置（如 gitnexus 等）
├── hooks.json                # optional：生命週期鉤子
├── rules/                    # 規則目錄 (*.md)
├── skills/                   # 技能目錄 (<skill>/SKILL.md)
└── agents/                   # 適配後的 SubAgents (*.md)
```

---

## 4. 升級後安裝與驗證流程

### 步驟 1：由 canonical generator 建立並驗證同一個 staging package

```bash
bin/dhpk distribution agy-plugin generate \
  --output /tmp/dhpk-agy-staging \
  --version=0.45.0 --json
bin/dhpk distribution agy-plugin validate \
  --output /tmp/dhpk-agy-staging --json
```

`scripts/agy-adapt-agents.js` 是 generator 內部使用的 transform；若需要單獨重跑，
只能使用帶有 `plugin.json`、`provenance.json`、`fingerprints.json` 與 `agents/`
的 owner-controlled package staging root：

```bash
node scripts/agy-adapt-agents.js --staging-root /tmp/dhpk-agy-staging
```

不得把 adapter 指向 `~/.gemini/config/plugins/dhpk` 或其子目錄。完成 structural
validation 後，安裝必須使用同一個已驗證的 staging package；這樣 canonical receipt、
collision 與 rollback ownership 才會沿著同一份產物傳遞：

```bash
node scripts/ci/install-agy-plugin.js install \
  --source /tmp/dhpk-agy-staging \
  --target ~/.gemini/config/plugins/dhpk
```

### 步驟 2：驗證外掛與 SubAgent 載入狀態

```bash
# 檢查 SubAgents 是否全數識別
agy agents

# 檢查 import record（不等於 native discovery）
agy plugins list
```

`agy plugins list` 只能確認 import record；native discovery 必須由隔離 HOME 的
`agy agents` 證據判定。預期輸出應包含目前產物註冊的 35 個 dhpk agents（例如
`code-reviewer`, `fast-worker`, `architect`, `planner` 等）。若隔離 runtime 仍無法載入，
應保留 `SKIP_INCOMPATIBLE` 或 `UNAVAILABLE` 證據，不得以靜態結構 PASS 取代。

### 步驟 3：在對話中呼叫測試

在 `agy` 對話中可直接透過 Subagent 派發工具呼叫：
```json
{
  "Subagents": [
    {
      "TypeName": "code-reviewer",
      "Role": "Code Reviewer",
      "Prompt": "Review recent modifications in working tree"
    }
  ]
}
```
