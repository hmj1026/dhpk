# dhpk Codex 雙軌

> **語言**：[English](./README.md) · **繁體中文**

Claude Code **不會**載入此 `codex/` 目錄。這裡把 plugin 的 Claude-side skill 與
agent 轉成 Codex CLI 格式，讓同時使用 Claude Code 與 Codex CLI 的專案不必維護
第二份設定 repo。

完整的 Supported project-local、legacy/native 與 standard Agent Plugin 路徑請見
[平台安裝 SSOT](../docs/platform-installation.zh-TW.md)。

`codex/skills/` 每個項目都是指向 `../../skills/<public-name>/` flat canonical
package 的 repo-relative symlink；這個 projection 沒有實體 skill copy。獨立的
`plugins/dhpk/` 才是追蹤中的 native physical package。

## 同步到專案

在專案根目錄執行：

`CLAUDE_PLUGIN_ROOT` 只會出現在 Claude Code 的 plugin-runtime shell。普通 terminal
請從持久的 checkout 呼叫相同 script，例如先設
`DHPK_ROOT=/absolute/path/to/dhpk`，再執行
`bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh"`；不要依賴暫時性的
marketplace cache path。

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```

預設採 **hybrid projection**：skill 與 receipt-managed supporting asset 會
symlink 回 source，但 `<project>/.codex/agents/*.toml` 一律建立為實體檔，讓
Codex 能載入 configuration layer。Plugin 更新後執行 `--update`；既有
receipt-owned agent link 會轉成實體檔，不會重做 skill link。Receipt 是
ownership boundary：只有記錄在
`.dhpk-installed.json` 且 destination 仍吻合 marker 的項目能被取代或移除。

### Flags

| Flag | 效果 |
|---|---|
| `--copy` | 將整個 projection 改為實體檔；預設 hybrid mode 的 agent TOML 已是實體檔。 |
| `--update` | 即使 receipt 版本相同仍重新對齊；plugin 更新後使用。 |
| `--migrate` | 升級 legacy receipt；只接管完全吻合且未變更的 destination。 |
| `--uninstall` | 移除未變更且 receipt-owned 的項目；保留 edited/orphan/unrelated asset。 |
| `--force` | 只略過 project-root heuristic；不會繞過 ownership 或安全檢查。 |
| `--help` | 印出 inline 摘要。 |

### Idempotency 與 migration

Script 寫入 schema-v3 `<project>/.codex/.dhpk-installed.json`，記錄 plugin 版本、
source fingerprint、mode，以及 skill、agent、supporting asset 的 managed-entry
inventory。Skill entry 保留 stable inventory id、目前 public name、destination、
fingerprint、source 與 mode。

在 `--update` 或 `--migrate` 時，receipt-owned 且未變更的 legacy skill destination
會重新命名為 public `dhpk-*`；已編輯、unowned、third-party、retargeted、malformed
或 ambiguous path 一律保留並回報 conflict。每次 mutating run 都會輸出 created、
updated、migrated、preserved、collision、pruned 與 orphaned 數量，不暴露絕對私人
路徑。缺少 `managed_entries` 的 legacy receipt 遇到同名 collision 時會 fail closed，
直到明確使用 `--migrate`。

## Plugin 更新後

1. `claude plugin update dhpk@dhpk`
2. 在每個 Codex 專案執行：
   `bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --update`

若從整併前版本升級，第一次改用 `--migrate --update`。完整名稱對照與 rollback 見
[`../docs/skill-platform-migration.zh-TW.md`](../docs/skill-platform-migration.zh-TW.md)。

## 呼叫 skill

Skill invocation 是 chat syntax，不是 plugin-management command。每個同步 skill
都在 `agents/openai.yaml` 宣告 public trigger。六個 capability family 使用未加
前綴名稱（`skill-scope`、`skill-forge`、`flow-guide`、`flow-drive`、
`change-verdict`、`code-trace`）；其他 first-party skill 維持 `dhpk-` 前綴。不要
使用 `$dhpk:<name>` 或 predecessor name；`codex plugin list` 只證明管理層安裝狀態，
仍須確認選定的 family 或 `$dhpk-<name>` 能解析。

主要流程的 Codex 入口是 `$flow-drive <task>`（該 family 被發現時），只分類可用
`$flow-drive --route-only <task>`。Codex 沒有 `/dhpk:do` command。若 `$flow-drive`
未被發現，使用 `AGENTS.md` 的 instruction routing 與明確 `/opsx:*`；不要虛構可呼叫
的 `/dhpk:do`。

## Agent roles

`codex/agents/` 提供 16 個可直接派送的角色：4 個手動維護的通用角色（`explorer`、
`worker`、`monitor`、`bug-investigator`），以及 12 個由 canonical agent 產生的角色
（`architect`、`code-reviewer`、`security-reviewer`、`database-reviewer`、`tdd-guide`、
`deep-reasoner`、`doc-reviewer`、`planner`、`spec-miner`、`frontend-reviewer`、
`migration-reviewer`、`e2e-runner`）。完整 role map、fallback 與 capability gate 見
[`AGENTS.md`](./AGENTS.md) 及 [`agent-role-map.json`](./agent-role-map.json)。

靜態 validation 與 current receipt 不等於可派發。必須啟動 fresh Codex session
並實際派發一個非內建 custom role；內建 `explorer` 不能作為 custom registry
canary。只有觀測到真實 spawn 與 targeted wait 才能記為 PASS；此前 named-role
runtime 維持 `NOT_RUN`、`UNAVAILABLE` 或實際觀測到的失敗。精確 ID 仍出現
`unknown agent_type` 時，應分類為 registry failure，不能據此改名或把
GPT-5.6 family model 換掉；診斷邊界見 [`AGENTS.md`](AGENTS.md#role-discovery)。

## 移除

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --uninstall
```

只會移除未變更且 receipt-owned 的項目。已編輯 managed entry 會標記為 orphan 並
保留，無關 `.codex` 內容不會被刪除。Uninstall 不需要 `--force`；該 flag 也不能
強迫刪除。若 `.codex/` 內有 project-owned asset，不要移除整個目錄。
