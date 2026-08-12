# 平台安裝指南

> **Languages**: [English](./platform-installation.md) · **繁體中文**

本文件是 dhpk 各 distribution surface 的安裝、驗證、支援層級與 rollback
SSOT。package 或 manifest 只能證明結構；只有指定的 consumer probe 找到
projection 內容後，才能宣稱 client 可呼叫。

## Surface matrix

| Surface | 安裝 | 更新／移除 | 驗證 | 支援邊界 |
|---|---|---|---|---|
| Codex project-local sync | checkout：`bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh`；Claude plugin runtime：`bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"` | `--update`、`--migrate`、`--uninstall`；`--force` 只繞過 project-root heuristic | `.codex/.dhpk-installed.json` schema-v3、managed entries、`$dhpk-<name>` discovery | Supported Codex path；安裝不等於 runtime callable |
| Codex legacy/native | 真實 CLI 支援時執行 `codex plugin marketplace add <repo-or-path>`、`codex plugin add dhpk@dhpk` | client marketplace 命令；從 source regenerate 並檢查 provenance | `plugins/dhpk/.codex-plugin/plugin.json`、physical `skills/`、provenance/fingerprints、real CLI probe | Experimental；CLI/route 缺少時為 `UNAVAILABLE` 或 `BLOCKED` |
| Standard Agent Plugin | 透過已驗證 client route 發布／安裝 `plugins/dhpk-agent/` | client-owned update/remove；只替換 generated package | root `plugin.json`、schema、固定 `skills/`、optional `mcp.json`、provenance | 結構合規不等於 Codex runtime proof |
| Cursor standard Agent Plugin | Cursor Customize/Plugins，或 local `~/.cursor/plugins/local/dhpk-agent` | Cursor reload/update/remove，或替換該 local package | root `plugin.json`、portable skills/MCP discovery、client version | 僅 portable skills/MCP；不宣稱 Cursor-native parity |
| Cursor Plugin | local `~/.cursor/plugins/local/dhpk-cursor`，或 reviewed `.cursor-plugin/marketplace.json`；另安裝 `plugins/dhpk-agent/` 供 shared portable skills 使用 | Cursor refresh/update/remove；只 rollback Cursor-owned files；shared Agent package 另行更新 | `.cursor-plugin/plugin.json`、rules、agents、commands、hooks、variables、shared-skill IDs | native components 需 Cursor evidence；shared portable skills 由 `dhpk-agent` 單獨擁有；缺口為 `SKIP_INCOMPATIBLE` |

## Prerequisites 與版本假設

以下各安裝段落使用對應表格列。此 repository 會記錄 package 與 schema
版本，但尚未驗證任何 consumer client 的最低版本。release evidence 必須記錄
實際 client version 與 probe result；不可由 package check 推導 runtime
`PASS`。

| Route | Client／版本假設 | OS 與 shell 假設 | 必要 tooling | Evidence gate |
|---|---|---|---|---|
| Codex project-local sync | Codex project-local loader；schema-v3 receipt；最低 Codex version 尚未建立 | Linux、macOS 或 WSL POSIX shell，從 project root 執行 | `bash`、`git`；Node.js 僅供 validator 使用 | 執行 installer、檢查 `.codex/.dhpk-installed.json`，並執行列出的 metadata/test 命令 |
| Codex legacy/native | 支援 marketplace/plugin 命令的 Codex CLI；執行 `codex --version`；最低 CLI version 尚未建立 | Linux、macOS 或 WSL shell | `codex`、marketplace access、`git` | 執行 marketplace route 並記錄 CLI 輸出；CLI/route 缺少時為 `UNAVAILABLE` 或 `BLOCKED` |
| Standard Agent Plugin | 實作 Agent Plugins 1.0.0 schema 的 consumer；最低 client version 尚未建立 | client 支援的 OS；package validation 從 POSIX shell 執行 | 已驗證的 Agent Plugin loader；Node.js 僅供結構驗證 | 執行兩個 package 命令，再記錄 client discovery evidence |
| Cursor standard Agent Plugin | 接受 portable package 的 Cursor desktop/plugin loader；記錄 Cursor version；最低版本尚未建立 | Cursor 支援的 desktop OS；local path 為 `~/.cursor/plugins/local/` | Cursor Customize → Plugins 或 local loader；Node.js 僅供 validation | reload 後觀察 discovered skills/MCP；無 loader 為 `UNAVAILABLE` 或 `BLOCKED` |
| Cursor Plugin（native） | 支援 `.cursor-plugin/plugin.json` 的 Cursor plugin loader；記錄 Cursor version；shared portable skills 另安裝 standard `dhpk-agent` package；最低版本尚未建立 | Cursor 支援的 desktop OS；local path 為 `~/.cursor/plugins/local/` | Cursor reload/UI、local filesystem、無 secret 的 variable 設定；以 Agent provenance 比對 shared IDs | reload 後觀察每個 selected native component 與 hook 行為；只有明確 matrix overlay 才能有 Cursor `skills/` |

## Status vocabulary

- `PASS`：適用證據已執行並驗證。
- `FAIL`：適用檢查失敗。
- `NOT_RUN`：規劃中的證據尚未執行。
- `NOT_CONFIGURED`：未選取 surface，也沒有 marker。
- `SKIP_INCOMPATIBLE`：指定 capability 沒有支援表示法，且已記錄 fallback。
- `BLOCKED`：明確要求，但 prerequisite 或 route 缺失。
- `UNAVAILABLE`：必要 client/tooling 未安裝或未提供。

不可把 static manifest、marketplace entry、generated file 或 enabled flag
直接轉成 runtime `PASS`。

## Codex project-local sync（Supported）

Prerequisites：Codex project-local loader、POSIX shell，以及上表第一列的
schema-v3 receipt contract。client version 必須等 release evidence 記錄後才算
已建立。

請從 project root 執行 checkout 版本：

```bash
bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh
```

在 Claude plugin runtime 使用 `${CLAUDE_PLUGIN_ROOT}`。installer 會使用
project-root heuristic，預設建立 relative symlink；需要實體檔時使用
`--copy`：

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --copy
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --update
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --migrate --update
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --uninstall
```

`--force` 只繞過 project-root heuristic，不繞過 ownership 或 filesystem
safety。schema-v3 receipt 記錄 stable ID、public name、destination、source、
mode 與 fingerprint。edited、user-owned、retargeted、malformed、ambiguous
或 collision 檔案必須保留並回報。

驗證：

```bash
test -f .codex/.dhpk-installed.json
node scripts/ci/validate-openai-metadata.js --root .
node tests/install-codex-skills.test.js
```

Rollback 使用 `--uninstall` 或還原已保存的 `.codex/` receipt；不要刪除整個
`.codex/` 目錄。

## Codex legacy/native package（Experimental）

Prerequisites：具 marketplace route 的實際 `codex` CLI、POSIX shell，以及已
記錄的 `codex --version`；本 repository 尚未驗證最低 CLI version。

保留的 native artifact 在 `plugins/dhpk/`，使用 legacy
`.codex-plugin/plugin.json`。真實 CLI 支援時：

```bash
codex plugin marketplace add <repo-or-path>
codex plugin add dhpk@dhpk
```

consumer 必須先具備 local marketplace。檢查 physical package、
`fingerprints.json`、`provenance.json` 與 client version。若 `codex` 或 route
不存在，記錄 `UNAVAILABLE`／`BLOCKED`，並保留 project-local sync。legacy
manifest 不得視為 Agent Plugins conformance proof。

## Standard Agent Plugin

Prerequisites：實作 Agent Plugins 1.0.0 schema 且有已驗證 loader route 的
client；本 repository 尚未驗證最低 client version。

`plugins/dhpk-agent/` 具有 Agent Plugins 1.0.0 root `plugin.json`、
immediate-child `skills/` 及 optional schema-versioned `mcp.json`。Claude/Codex
invocation policy 留在 client-owned metadata；portable skill frontmatter 只含
standard fields 與 nested metadata。

```bash
node scripts/ci/validate-agent-plugin-package.js plugins/dhpk-agent
node scripts/ci/verify-platform-packages.js
```

這些檢查證明 package shape、containment、deterministic fingerprints 與
provenance，不證明 Codex 或 Cursor runtime discovery。

## Cursor standard Agent Plugin

Prerequisites：具 local plugin loader 的 Cursor desktop client，以及已記錄的
Cursor version；本 repository 尚未驗證最低版本。

Cursor 可用 `plugins/dhpk-agent/` 取得 portable skills 與 optional MCP：

1. 在 Cursor **Customize → Plugins** 選 reviewed local package，或複製到
   `~/.cursor/plugins/local/dhpk-agent`。
2. Reload window。
3. 在 Cursor plugin view 驗證 discovered skill names 與 MCP entries。

記錄 Cursor version 與 probe output。沒有 supported local loader 或 CLI 時，
維持 `UNAVAILABLE`／`BLOCKED`；不可從此 package 宣稱 native rules、commands、
agents 或 hooks。

## Cursor Plugin（native components）

Prerequisites：loader 支援 native manifest/components 的 Cursor desktop client，
以及已記錄的 Cursor version；本 repository 尚未驗證最低版本。

native projection 是 `plugins/dhpk-cursor/`，manifest 為
`.cursor-plugin/plugin.json`。local 測試：

```bash
mkdir -p ~/.cursor/plugins/local
cp -R plugins/dhpk-cursor ~/.cursor/plugins/local/dhpk-cursor
```

也可使用 reviewed `.cursor-plugin/marketplace.json` source。Reload Cursor，
不要提交 credential 的 variables，並驗證選取的 `rules/`、`agents/`、
`commands/` 與 `hooks/hooks.json`。portable skills 不會複製到這個 native
package：請安裝 `plugins/dhpk-agent/` 作為專案唯一的 physical skill store，
再以兩份 provenance 的 stable IDs 互相比對。不要手動建立第二份 `skills/`。
只有明確的 environment-specific matrix overlay 可以加入 Cursor `skills/`，
且該 overlay 必須記錄 transform 與獨立 fingerprint。不支援的 component
為 `SKIP_INCOMPATIBLE` 並記錄 matrix fallback；缺少 Cursor tooling 為
`UNAVAILABLE`。

Rollback 只移除或還原 `~/.cursor/plugins/local/dhpk-cursor` 與其
Cursor-owned receipt，不可刪除 Codex、Claude、project-owned Cursor files 或
portable `dhpk-agent` package。

## Maintainer evidence

每個 generated surface 記錄 release version、source commit/tag、inventory
digest、generator version、stable IDs、public names、transforms 與 physical
fingerprints。release evidence 另記 client versions、install route、probe
result 及所有未執行 gate。規範見
`openspec/changes/align-agent-plugin-platform-support/specs/` 與
[distribution surface guide](./distribution-surfaces.zh-TW.md)。
