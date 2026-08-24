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
| Cursor project-local sync | checkout：`bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh`；Claude plugin runtime：`bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh"` | `--update`、`--migrate`、`--uninstall`；`--force` 只繞過 project-root heuristic | `.cursor/.dhpk-installed.json` schema-v3、`.mdc` rules、managed entries | Supported Cursor project-local path；native hooks 不在 v1；安裝不等於 runtime callable |
| Cursor CLI launch-scoped probe | 登入後執行 `cursor-agent --plugin-dir <agent-package> --plugin-dir <cursor-package>` | CLI 沒有 persistent install；更新 source package 或 local symlink 後重開 session | `cursor-agent --version`、`cursor-agent status` 與 read-only `--mode ask` probe | Experimental/conditional：CLI help 有此 flag，但官方 CLI 文件尚未建立 plugin component discovery；marketplace indexing 不是 non-interactive install command |
| AGY native plugin | 產生 `plugins/dhpk-agy/`，再由 receipt-owned installer 安裝至 `~/.gemini/config/plugins/dhpk/` | `install-agy-plugin.js update`、`uninstall` 或 `rollback`；foreign files 保留，collision fail closed | AGY package validator；`agy plugins list` 只列 import；隔離 HOME 的 `agy agents` 才是 native load；以及 optional bounded Subagent probe | Experimental：package/discovery 與 runtime 分開；缺少 `agy` 為 `UNAVAILABLE` |

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
| Cursor project-local sync | Cursor project-local loader；schema-v3 receipt；最低 Cursor version 尚未建立 | Linux、macOS 或 WSL POSIX shell，從 project root 執行 | `bash`、`git`；Node.js 僅供 validator 使用 | 執行 installer、檢查 `.cursor/.dhpk-installed.json`，並執行列出的 installer 測試；缺少 live Cursor client 不得視為 runtime `PASS` |
| Cursor CLI launch-scoped probe | `cursor-agent` 在 `PATH`；記錄 `cursor-agent --version`；使用 `cursor-agent login` 驗證；最低版本尚未建立 | Linux、macOS 或 WSL POSIX shell | `cursor-agent`、`--plugin-dir`、Cursor account/API key；Node.js 僅供 package validation | Experimental/conditional：先執行 `cursor-agent status` 再做 read-only probe；未登入為 `BLOCKED`、缺 CLI 為 `UNAVAILABLE`，discovery 另行記錄 |
| AGY native plugin | `agy` version 與 AGY model/tool enum 尚未鎖定；可用時記錄 `agy --version` | Linux、macOS 或 WSL POSIX shell；install root 為 user scope | Node.js、`git`、generated package，以及 optional `agy` CLI | 先做 structural validation；`agy plugins list` 只列 import，隔離 HOME 的 `agy agents` 才是 native load；除非明確使用 `--agy-runtime-probe`，runtime 保持 `NOT_RUN` |

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

## Unified lifecycle CLI（唯讀 slice）

`dhpk-install <surface> <action>` 是共同 lifecycle entrypoint。允許的 surface
為 `claude`、`codex-sync`、`codex-native`、`agent-plugin`、`cursor`、`agy-plugin`；action 為
`plan`、`install`、`verify`、`update`、`uninstall`、`rollback`、`status`。此初始
slice 只啟用 deterministic、唯讀的 `plan`、`status` 與 `verify` result
construction，例如：

```bash
dhpk-install cursor plan --scope project --json
```

從 source checkout 執行時，直接使用 bundled entrypoint：
`bash /path/to/dhpk/bin/dhpk-install cursor plan --scope project --json`。

JSON result 會將 normalized request 與 compiler plan 綁定，並將 closed
projection evidence vocabulary 與 lifecycle presentation 分開。`INSTALL_PASS +
CONSUMER_BLOCKED` 不是 projection `PASS`，也不能提升 support tier。目前 write
action 在任何 mutation 前都會回傳 `BLOCKED` 與 stable `NOT_IMPLEMENTED`
diagnostic。尤其是 Codex project-local write 仍應使用既有
`install-codex-skills.sh`，Cursor project-local write 應使用
`install-cursor-harness.sh`，直到這些 adapter 透過相同的 ArtifactStore
transaction 遷移。

## Unified distribution CLI

`bin/dhpk distribution <surface> <operation>` 是保留 native package surface
的唯一 deterministic package boundary：`agent-plugin`、`cursor-plugin`、
`codex-native` 與 `agy-plugin`。operation 為 `generate`、`validate` 與
`verify`；每個 JSON result 都記錄 structural evidence，除非另行執行
client-specific probe，否則明確回傳 `runtime: NOT_RUN`。

```bash
bin/dhpk distribution agy-plugin generate --output plugins/dhpk-agy --version=0.46.0 --json
bin/dhpk distribution agy-plugin validate --json
```

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
或 collision 檔案必須保留並回報。未帶 `--adopt` 的 `--update` 在仍有
collision 時以非零狀態結束，避免把 partial receipt 誤認為 current。

若 projection stale 或有 unowned collision，先執行唯讀 plan：

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" \
  --update --plan --json
```

只有 owner 明確批准一個 exact collision，才把 plan 回報的 destination 與
source fingerprint 帶入 adoption。省略 `--copy`，installer 會沿用 receipt
原本的 projection mode，避免重新 materialize 無關的 managed entries：

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" \
  --update \
  --adopt='skills/dhpk-cross-agent-sync@<destination-fingerprint>@<source-fingerprint>'
```

adoption 只作用於指定 path，並會在 promotion 前建立可 rollback 的 backup；不會
授權其他 path 或其他 consumer surface。若 plan 後 fingerprint 已改變，command
會在 mutation 前失敗，必須重新 plan。完成後檢查
`.codex/.dhpk-installed.json` 的 `adopted`、`backups` 與 `evidence.paths`，才可
判定 projection 已 current。

先從 consumer project root 驗證已 materialize 的 projection：

```bash
test -f .codex/.dhpk-installed.json
```

再從 dhpk checkout 執行 source-check validator。將 `DHPK_ROOT` 設為包含
`scripts/` 與 `tests/` 的 checkout；這些檔案不會複製到 consumer project：

```bash
DHPK_ROOT=/absolute/path/to/dhpk
node "$DHPK_ROOT/scripts/ci/validate-openai-metadata.js" --root "$DHPK_ROOT"
node "$DHPK_ROOT/tests/install-codex-skills.test.js"
```

Rollback 使用 `--uninstall` 或還原已保存的 `.codex/` receipt；不要刪除整個
`.codex/` 目錄。

### 檢查 Codex 重複 discovery

Project-local sync 與 experimental native package 是兩條獨立 acquisition
surface。host 若同時 discovery 兩者，即使內容是刻意配置，也可能讓同一個
public skill name 顯示兩次。先設定 `DHPK_ROOT` 為 source checkout，再從
consumer project root 執行下列唯讀檢查：

```bash
node "$DHPK_ROOT/scripts/ci/check-codex-discovery.js" \
  --repo-root "$DHPK_ROOT" \
  --project-root "$PWD" \
  --native-root "$DHPK_ROOT/plugins/dhpk"
```

Registry 以 `kind:publicName` 聚合 entry。fingerprint 相同時會合併成一筆
`effective` entry，但保留兩個 provider 證據；fingerprint 不同時，必須有
current 且 receipt-owned 的 precedence，否則回傳 `BLOCKED`。current 的
project-local entry 明確優先於 experimental native entry 時回傳 `WARN`。這個
command 只回報證據，不會刪除 projection、cache 或 host registration。遇到
`BLOCKED` 時，先檢查 receipt 並選定一條支援的 route，再執行 update 或
uninstall。

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
bin/dhpk distribution agent-plugin validate --json
node scripts/ci/verify-platform-packages.js
```

這些檢查證明 package shape、containment、deterministic fingerprints 與
provenance，不證明 Codex 或 Cursor runtime discovery。

Cursor consumer-runtime evidence 只接受 `cursor-agent` CLI。portable Agent
Plugin route 只允許一個 plugin directory：

```bash
cursor-agent --plugin-dir <agent-package> --mode ask --trust -p <smoke-prompt> --output-format json
```

這條 portable route 不得加入 Cursor-native directory、Codex marketplace
命令或 agent-plugins.org 參數。

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
agents 或 hooks。Cursor desktop GUI、**Customize → Plugins**、desktop
`cursor` binary 與 project-local `.cursor/` 檔案是不同安裝路徑，不是
`cursor-agent` runtime proof。

## Cursor CLI（launch-scoped probe）

Cursor CLI 是獨立於 Cursor desktop plugin loader 的 consumer surface。本指南
中的 **launch-scoped** 是指 `--plugin-dir` 只把 package 傳給單次
`cursor-agent` invocation；它不會安裝或註冊 persistent plugin。目前 CLI help
提供 `--plugin-dir`，但官方 CLI 文件尚未建立 plugin component discovery，
所以在有 versioned consumer probe 成功前，這條 route 是
experimental/conditional。`plugin` subcommand 也沒有 non-interactive
`plugin install` 命令。不可把 `cursor-agent plugin marketplace add` 說成
dhpk 安裝；它只會加入或更新 marketplace index。

Prerequisites：記錄 `cursor-agent --version`、已登入的 Cursor CLI session，
以及本機可讀取兩個 dhpk package。只使用 API key 不構成 consumer-runtime
proof。先確認 authentication：

```bash
cursor-agent --version
cursor-agent status
cursor-agent login  # 只有 status 顯示 Not logged in 時才執行
```

執行 launch-scoped、read-only probe 時，使用有界 wrapper 並明確傳入兩個
package directory。wrapper 會以有限 timeout 與 output cap 執行下列命令：

```bash
node scripts/release/cursor-agent-probe.js \
  --agent-package "$HOME/.cursor/plugins/local/dhpk-agent" \
  --cursor-package "$HOME/.cursor/plugins/local/dhpk-cursor" \
  --timeout-ms 60000 \
  --max-output-bytes 262144
```

wrapper 實際執行的 launch command 等同於：

```bash
cursor-agent \
  --plugin-dir "$HOME/.cursor/plugins/local/dhpk-agent" \
  --plugin-dir "$HOME/.cursor/plugins/local/dhpk-cursor" \
  --mode ask \
  --trust \
  -p 'List the dhpk skills, commands, agents, and rules you discover. Do not edit files.' \
  --output-format json
```

portable Agent Plugin probe 只使用一個 directory：

```bash
cursor-agent \
  --plugin-dir <agent-package> \
  --mode ask \
  --trust \
  -p <smoke-prompt> \
  --output-format json
```

wrapper 也會傳 `--trust`，避免 launch-scoped probe 卡在互動式 workspace
確認提示，並忽略 stdin，避免子行程繼承呼叫端 TTY。若要同等的不卡住證據，
不要把等同的 `cursor-agent` argv 貼進互動式 shell。

記錄 exact CLI version、authentication status、package paths 與 probe output。
package validator 只證明 structure 與 provenance；runtime `PASS` 必須由已登入的
`cursor-agent` CLI 實際 discover projection content；在此之前 CLI route 維持
`NOT_RUN` 或 `BLOCKED`。若 CLI 回報 `Authentication required`，在完成 login
前證據是 `BLOCKED`。若缺少 `cursor-agent`，記錄 `UNAVAILABLE`；desktop
`cursor` binary、GUI discovery 與 project-local `.cursor/` installer 都不是
替代證據。missing CLI（缺少 `cursor-agent`）記錄為 `UNAVAILABLE`。`cursor-sync` installer identity row 在未執行 installer runtime
時預期為 `NOT_RUN`，不等於 Cursor consumer-runtime PASS。若安裝的 CLI 沒有 `--plugin-dir`，記錄 `UNAVAILABLE`，
Cursor desktop GUI、Customize → Plugins、desktop `cursor` binary 與
project-local `.cursor/` 安裝只屬於 setup 或 installer evidence，不能替代已登入
`cursor-agent` 的 runtime proof。
即使要求更大的值，probe 仍強制 5 分鐘 timeout 上限與 4 MiB output 上限。
若 wrapper 回報 `SKIP_INCOMPATIBLE` 且 `timed_out: true`、`no_stdout: true`，
代表 CLI 在期限內沒有任何輸出。目前 `cursor-agent` 沒有非 LLM 的 plugin
list；`--plugin-dir` 加上 `--mode ask` 會啟動可能掛起的完整 session。這是
CLI 限制，不是套件失敗。若 wrapper 回報 `BLOCKED` 且 `timed_out: true` 或
`output_limited: true`，代表沒有產生 consumer result；保留有界、已 redact
的 diagnostic，只能以另一組有限 limit 重試。
wrapper 也會阻擋空白、無效或缺少 capability 的 response；只有包含要求的
dhpk skills、commands、agents、rules 證據，才能記錄為完成的 probe。

若要為 Cursor desktop 建立 persistent local setup，可在
`~/.cursor/plugins/local/` 使用 symlink 或 copy；CLI probe 仍要明確傳入這些
path，更新後重開 Cursor desktop/session：

```bash
mkdir -p ~/.cursor/plugins/local
ln -s /absolute/path/to/dhpk/plugins/dhpk-agent ~/.cursor/plugins/local/dhpk-agent
ln -s /absolute/path/to/dhpk/plugins/dhpk-cursor ~/.cursor/plugins/local/dhpk-cursor
```

建立 link 前先確認 target 不存在；不可覆蓋 user-owned plugin。Rollback 只移除
這兩個 dhpk link。

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

## Cursor project-local sync（Supported）

Prerequisites：Cursor project-local loader、POSIX shell，以及上表 Cursor
project-local 列的 schema-v3 receipt contract。client version 必須等 release
evidence 記錄後才算已建立。

此路徑與 `plugins/dhpk-cursor/`（marketplace／user-scoped plugin）分開。
project-local 檔案只在 installer 執行後出現於 consumer `.cursor/`。native
`.cursor/hooks.json` mapping 不在 v1；此 installer 不會寫入 `hooks.json`。
若 Third-party skills 開啟，Cursor 仍可能從 `.claude/settings.json` 載入
Claude hooks——那是可選相容路徑，不是 v1 owner。

支援路徑的版本 SSOT 是 local packages
`~/.cursor/plugins/local/dhpk-agent` 與
`~/.cursor/plugins/local/dhpk-cursor`，加上 project-local schema-v3
receipt `.cursor/.dhpk-installed.json`。Cursor 也可能在
`~/.cursor/plugins/cache/dhpk/dhpk/<hash>/` 留下 marketplace hash
cache。local packages 更新後，該 cache 的 `plugin.json` 仍可能停在舊版；
它不是 SSOT，不可當成已安裝版本。
`install-cursor-harness.sh --update --plan --json` 在 cache manifest
version 與 local packages 或 planned `plugin_version` 不一致時，會回報
`warnings[].code = cursor_marketplace_hash_cache_drift`。請在 Cursor UI
停用或移除 marketplace dhpk plugin，只保留 local packages 與
project-local receipt。除非 Cursor 已卸載該 marketplace plugin，否則不要
手刪 hash cache。

請從 project root 執行 checkout 版本：

```bash
bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh
```

Claude plugin runtime 使用 `${CLAUDE_PLUGIN_ROOT}`。installer 使用
project-root heuristic，預設建立相對 symlink，並支援 `--copy`：

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh" --copy
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh" --update
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh" --migrate --update
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh" --uninstall
```

`--force` 只繞過 project-root heuristic，不會繞過 receipt ownership 或 path
safety。schema-v3 receipt 記錄 stable ID、public name、destination、source、
mode 與 fingerprint。已編輯、user-owned、retargeted、malformed、ambiguous 或
colliding 的檔案會被保留並回報。未帶 `--adopt` 的 `--update` 在仍有
collision 時以非零狀態結束，避免把 partial receipt 誤認為 current。

對 stale 或 unowned projection，先檢查再變更：

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh" \
  --update --plan --json
```

Planning 是唯讀。若 owner 核准一個精確 collision，把兩份 fingerprint 複製到
explicit adoption request。省略 `--copy`：installer 會保留 receipt 既有
projection mode：

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh" \
  --update \
  --adopt='skills/dhpk-cross-agent-sync@<destination-fingerprint>@<source-fingerprint>'
```

Adoption 以 path 為範圍，並在 promotion 前建立可 rollback 的 backup。fingerprint
若已變更，命令會在 mutation 前失敗；請重新 plan。將 projection 視為 current
前，先檢查 `.cursor/.dhpk-installed.json`。

從 consumer project root 驗證：

```bash
test -f .cursor/.dhpk-installed.json
```

source-check validator 必須從 dhpk checkout 執行。將 `DHPK_ROOT` 設為擁有
`scripts/` 與 `tests/` 的 checkout；這些檔案不會複製到 consumer project：

```bash
DHPK_ROOT=/absolute/path/to/dhpk
node "$DHPK_ROOT/scripts/ci/validate-cursor-sync.js"
node "$DHPK_ROOT/tests/install-cursor-harness.test.js"
```

Rollback 使用 `--uninstall` 或還原已儲存的 `.cursor/` receipt。不要刪除整個
`.cursor/` 目錄。`dhpk-install cursor` write 仍為 `NOT_IMPLEMENTED`；支援的
write path 是此 bash installer。

## AGY／Antigravity CLI plugin（Experimental）

AGY projection 是獨立的 owner-scoped package。它只轉換 canonical agent
frontmatter，不會改寫 `agents/`。請從 dhpk checkout 產生與驗證：

```bash
bin/dhpk distribution agy-plugin generate --output plugins/dhpk-agy --version=0.46.0 --json
bin/dhpk distribution agy-plugin validate --json
```

只在文件化的 user path 安裝、更新與移除 receipt-owned package。若 target
有 foreign file 或 changed owned file，視為 collision 並保持原檔：

```bash
node scripts/ci/install-agy-plugin.js install \
  --source plugins/dhpk-agy \
  --target "$HOME/.gemini/config/plugins/dhpk" --json
node scripts/ci/install-agy-plugin.js update \
  --source plugins/dhpk-agy \
  --target "$HOME/.gemini/config/plugins/dhpk" --json
node scripts/ci/install-agy-plugin.js plan \
  --source plugins/dhpk-agy \
  --target "$HOME/.gemini/config/plugins/dhpk" --json
node scripts/ci/install-agy-plugin.js status \
  --source plugins/dhpk-agy \
  --target "$HOME/.gemini/config/plugins/dhpk" --json
node scripts/ci/install-agy-plugin.js rollback \
  --target "$HOME/.gemini/config/plugins/dhpk" --json
```

`plan` 與 `status` 都是唯讀操作，會回報 source／target version、receipt
ownership、physical `.git` marker，以及有界的 same／changed／missing 檔案證據。
若 physical Git checkout 沒有相符的 AGY receipt，分類為
`FOREIGN_CHECKOUT` 並回傳 `BLOCKED`；owner 必須自行備份、移動或退役該
checkout，之後才能 clean install。診斷不會自動 migration、adoption、覆寫或
移除 foreign target。

configured-platform validation 與 package validation 分開執行：

```bash
python3 skills/dhpk-cross-agent-sync/scripts/multi_ai_sync.py \
  --root . validate --targets agy --format json
agy --version
agy plugins list
agy agents
```

`agy plugins list` 只列出 import records。安裝在
`~/.gemini/config/plugins/dhpk` 的 native receipt-owned package 是由
隔離 HOME 的 `agy agents` 發現，不能用 import JSON 裡出現 `dhpk` 當證明。
validator 會把 package bind 到 sandbox 內的這個 consumer path。
AGY 1.1.13 沒有 native filesystem plugin loader，所以隔離 HOME 的
`agy agents` 會是空的；這組結果是 `SKIP_INCOMPATIBLE`，不是 package-shape
`FAIL`。不要對 receipt-owned target 跑 `agy plugin install`：那不是 native
registration 步驟，而且可能把 `plugin.json` 截成空檔。

AGY runtime prerequisites 是 `agy` CLI、目前支援的 `bwrap` POSIX sandbox
backend，以及明確指定的 `DHPK_AGY_HOST_HOME`，其中必須有 allowlisted
login file。runtime probe 只把 allowlisted files 複製到 disposable HOME，
以 read-only 方式 mount package，並只在 runtime invocation 開啟 network。
缺少 login 是 `BLOCKED`；缺少 `agy` 或 `bwrap` 是 `UNAVAILABLE`；未明確使用
`--agy-runtime-probe` 時 runtime 是 `NOT_RUN`。runtime diagnostics 有界且已
redact，不記錄 host credential 內容。

報告分開記錄 package structure、plugin/agent discovery 與 Subagent runtime。
若 `agy` 不在 `PATH`，discovery 是 `UNAVAILABLE`；未使用
`--agy-runtime-probe` 時 runtime 是 `NOT_RUN`。CLI 可用時，opt-in probe
有界且唯讀：

```bash
python3 skills/dhpk-cross-agent-sync/scripts/multi_ai_sync.py \
  --root . validate --targets agy --agy-runtime-probe --format json
```

不可把 static manifest、`agy agents` listing 或 foreign-checkout 診斷升級成
runtime `PASS`。
rollback／uninstall 只移除符合 AGY provenance receipt 的檔案，並保留 plugin
directory 內的 user-owned files。

## Maintainer evidence

每個 generated surface 記錄 release version、source commit/tag、inventory
digest、generator version、stable IDs、public names、transforms 與 physical
fingerprints。release evidence 另記 client versions、install route、probe
result 及所有未執行 gate。版本控管的規範見
`openspec/specs/`（特別是 `agy-cli-subagent-plugin/spec.md` 與
`platform-installation-documentation/spec.md`）與
[distribution surface guide](./distribution-surfaces.zh-TW.md)。
