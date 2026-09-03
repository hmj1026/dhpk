# Skill platform 整併、遷移與 Codex MCP 退休

> **語言**：[English](./skill-platform-migration.md) · **繁體中文**

本指南是 collision-safe skill platform 的升級契約，適用於維護者、Claude
marketplace 使用者、會把 dhpk 同步到 `.codex/` 的專案，以及同時安裝 Matt
Pocock 或其他全域 skill 的使用者。

目前 Codex/Cursor 安裝路徑與 rollback 邊界請以[平台安裝 SSOT](./platform-installation.zh-TW.md)為準。

## 目前契約

| 關注點 | 目前實作 |
|---|---|
| Canonical source | `skills/<public-name>/` 下 85 個扁平 package |
| Public identity | 六個 capability family 使用未加前綴名稱；其他 first-party name 維持 `dhpk-*` |
| Inventory SSOT | `manifests/distribution-inventory.json` schema v2 |
| Module projection | `modules/*/skills/` 下 37 個相對 symlink |
| Codex 專案 projection | `codex/skills/` 下 18 個相對 symlink（16 個可呼叫加內部 transport 與 dispatch-context runtime） |
| Codex native package | `plugins/dhpk/skills/` 下 18 個實體 package，零 symlink |
| Codex 專案 receipt | `.codex/.dhpk-installed.json` schema v3 |
| 預設 hooks | `PreToolUse`、`PostToolUse`、`SessionStart`、`SubagentStop` |

目錄位置與 README 清單都不是權威來源。Inventory 管理 stable id、public name、
lifecycle、module 與 publication surface；validator 會將每個 projection 與它對齊。

## 呼叫語法

不同 host surface 刻意使用不同語法：

| Surface | 語法 | 範例 |
|---|---|---|
| Claude command | `/dhpk:<command>` | `/dhpk:harness-audit` |
| Claude plugin skill | `/dhpk:<public-skill-name>` | `/dhpk:change-verdict` |
| Codex skill | discovery 後使用 `$<public-skill-name>` | `$change-verdict --mode code` |
| Cursor generated command | 產生的 host adapter | Cursor `do` command（`host=cursor`） |
| Codex main-flow entry | discovery 後使用 `$flow-drive --mode route|implement <task>` | `$flow-drive --mode implement fix the login redirect` |

Codex 內建 command（`/hooks`、`/agent`）不是 dhpk 自訂 `/dhpk:*` command。
明確的 `flow-drive` family 是 Codex implementation entry；`flow-guide` 負責
implicit classification 與 gate。可用性證據是 receipt-owned 的
`.codex/skills/flow-drive` 能解析為 `$flow-drive`；`codex plugin list` 只是管理層
證據。若 family 未被發現，instruction routing 與明確 `/opsx:*` OpenSpec command
仍可用——不要宣稱 Codex 有可呼叫的 `/dhpk:do`。

`dhpk` prefix 仍是 Claude plugin namespace 的一部分。六個 reborn family 刻意使用未
加前綴的名稱，讓使用者選擇 task-shaped capability 而不必記住 predecessor 的
implementation name。

<a id="alias-free-retirement-ledger-0470"></a>

## Alias-free retirement ledger（0.47.0）

`manifests/distribution-inventory.json` 是 retirement identity 的 SSOT。
`retired_skills` 包含五筆 0.47.0 historical rows 及後續 retirement wave；下表是這些
historical row 的原 stable identity、`reasonCode`、
replacement 指引與 rollback pin 的文件投影。Retirement row 只供診斷 metadata 使用：
不是 active skill、materialized package、discovery alias，也不會進入任何 generated
projection。

| Former stable ID | Former public name | `reasonCode` | Replacement guidance | `rollback.release` |
|---|---|---|---|---|
| `bug-fix` | `dhpk-bug-fix` | `merged-into-adaptive-workflow` | current successor `flow-guide`（`classify` mode）；0.47.0 historical route was `adaptive-dev-workflow`（`bug` mode） | `0.46.1` |
| `feature-dev` | `dhpk-feature-dev` | `merged-into-adaptive-workflow` | current successor `flow-guide`（`classify` mode）；0.47.0 historical route was `adaptive-dev-workflow`（`feature` mode） | `0.46.1` |
| `post-dev-test` | `dhpk-post-dev-test` | `split-by-test-level` | stable ID `tdd`；Claude `/dhpk:dhpk-tdd-workflow`；Codex `$dhpk-tdd-workflow`（`unit-integration` mode）；agent `e2e-runner`（`playwright-journey` mode） | `0.46.1` |
| `codex-brainstorm` | `dhpk-codex-brainstorm` | `merged-into-architect-mode` | stable ID `software-architecture`；Claude `/dhpk:dhpk-module-design`；Codex `$dhpk-module-design`（`adversarial` mode） | `0.46.1` |
| `de-ai-flavor` | `dhpk-de-ai-flavor` | `model-default-capability-removal` | `model-default` 指引；沒有 successor package | `0.46.1` |

### Direct-host 呼叫邊界

這是 release-prep 文件：checked-in package/provenance metadata 在最終 clean release
commit 發布 `0.47.0` 前仍綁定 `0.46.1`。

能接收 skill identity 的 dhpk-owned helper、package 與 receipt-bound installation
interface 可以攔截上述 row，回報包含 release、reason 及 successor 或 model-default
指引的穩定非零 retirement diagnostic。`scripts/run-skill.sh` 是其中一個 helper seam；
receipt-bound planning/update 會回報 retirement evidence，但不會 materialize alias。外部
host 直接呼叫 Skill 時會繞過這些 dhpk-owned seam；回應仍由 host 擁有，可以是
`unknown-skill`。dhpk 不宣稱 unsupported direct invocation 可被攔截，也不宣稱舊名稱
仍可解析。

Rollback 是 version pinning，不是 hidden aliasing：請透過 receipt-bound installation
path pin 並重新安裝最後相容的 release，不要重建退休 package 或 discovery alias。下方
Codex MCP capability retirement 以仍帶有該 grant 的最後相容 release `0.51.0` 為 pin。

<a id="alias-free-codex-mcp-retirement-ledger"></a>

## Alias-free Codex MCP capability retirement ledger（0.52.0）

這是本次 migration 退休的九個 MCP-backed capability identity 的歷史專用 ledger，不是
active route registry：任何 former MCP identity 都不是 alias、generated package、discovery
target 或 hidden fallback。Parity matrix 記錄完整 capability evidence；本表記錄 identity
處置與 rollback pin。

| Former stable ID | Former MCP-facing identity | Replacement owner and behavior | `reasonCode` | `rollback.release` |
|---|---|---|---|---|
| `codex-architect` | `dhpk-codex-architect` | `dhpk-module-design`；current-model design/review/compare/adversarial mode，只能明確選用 `codex exec` | `migrated-to-module-design` | `0.51.0` |
| `codex-implement` | `dhpk-codex-implement` | `flow-drive`；current-model decomposition、implementation、verification、review 與 bounded retry loop（`implement` mode） | `migrated-to-backend-neutral-implement` | `0.51.0` |
| `codex-code-review` | `dhpk-change-review` 的 MCP default | `dhpk-change-review --backend cli`；current-model default 與明確 CLI review，不提供 MCP fallback | `migrated-to-cli-review-owner` | `0.51.0` |
| `doc-review` | `dhpk-doc-review` 的 MCP review/reply | `dhpk-doc-review`；portable 五維 review 與 gate，只能明確選用 `codex exec` | `migrated-to-portable-review` | `0.51.0` |
| `test-review` | `dhpk-test-review` 的 MCP review/reply | `dhpk-test-review`；portable sufficiency、edge-case、quality 與 AC-trace review；generation 仍由 `dhpk-tdd-workflow` 負責 | `migrated-to-portable-review` | `0.51.0` |
| `codebase-exploration` | `dhpk-codebase-exploration` 的 MCP dual perspective | `dhpk-codebase-exploration`；current-model trace 加 isolated 或明確選取的 CLI second opinion | `migrated-to-isolated-perspective` | `0.51.0` |
| `feature-verify` | `dhpk-feature-verify` 的 MCP P5 verdict | `dhpk-feature-verify`；independent reviewer 只可明確選用，primary-only 結果標記 degraded | `migrated-to-explicit-reviewer` | `0.51.0` |
| `issue-analyze` | `dhpk-issue-analyze` 的 fresh MCP verdict | `dhpk-issue-analyze`；current-model classification 加 isolated 或明確選取的 CLI blind opinion | `migrated-to-explicit-reviewer` | `0.51.0` |
| `feasibility-study` | `dhpk-feasibility-study` 的 MCP discussion/reply | `dhpk-feasibility-study`；current-model options/comparison 加 isolated 或明確選取的 CLI opinion | `migrated-to-explicit-reviewer` | `0.51.0` |

每一列的 rollback path 都相同：pin 並透過 receipt-bound installation flow 重新安裝仍帶有
MCP grant 的最後相容 `0.51.0` release。不要在目前 release 把這些名稱恢復成 discovery
alias，也不要加入靜默 MCP retry。八列（issue 與 feasibility owner 刻意共用一列）及其
八列（issue 與 feasibility owner 刻意共用一列）及其 migration evidence 請見
[capability-parity matrix](./codex-mcp-capability-parity.md)。

## Capability-family retirement ledger（0.53.0）

Inventory 準確擁有 22 筆 alias-free row。每筆都使用
`reasonCode: capability-family-consolidation`、rollback `0.52.0`，並指向一個
family mode。下表是這個 closed mapping 的文件投影，不是 discovery 或 compatibility
registry。

| Former stable ID | Former public name | Replacement family/mode | `reasonCode` | `rollback.release` |
|---|---|---|---|---|
| `skill-health-check` | `dhpk-skill-health-audit` | `skill-scope` / `health` | `capability-family-consolidation` | `0.52.0` |
| `skill-judge` | `dhpk-skill-quality-judge` | `skill-scope` / `judge` | `capability-family-consolidation` | `0.52.0` |
| `skill-stocktake` | `dhpk-skill-stocktake` | `skill-scope` / `stocktake` | `capability-family-consolidation` | `0.52.0` |
| `skill-scout` | `dhpk-skill-scout` | `skill-scope` / `scout` | `capability-family-consolidation` | `0.52.0` |
| `create-skill` | `dhpk-create-skill` | `skill-forge` / `create` | `capability-family-consolidation` | `0.52.0` |
| `rules-distill` | `dhpk-rules-distill` | `skill-forge` / `distill-rules` | `capability-family-consolidation` | `0.52.0` |
| `adaptive-dev-workflow` | `dhpk-adaptive-dev-workflow` | `flow-guide` / `classify` | `capability-family-consolidation` | `0.52.0` |
| `dhpk-execution-policy` | `dhpk-execution-policy` | `flow-guide` / `policy` | `capability-family-consolidation` | `0.52.0` |
| `next-step` | `dhpk-next-step` | `flow-guide` / `next` | `capability-family-consolidation` | `0.52.0` |
| `execution-checklist` | `dhpk-execution-checklist` | `flow-guide` / `checklist` | `capability-family-consolidation` | `0.52.0` |
| `do` | `dhpk-do` | `flow-drive` / `route` | `capability-family-consolidation` | `0.52.0` |
| `implement` | `dhpk-implement` | `flow-drive` / `implement` | `capability-family-consolidation` | `0.52.0` |
| `codex-code-review` | `dhpk-change-review` | `change-verdict` / `code` | `capability-family-consolidation` | `0.52.0` |
| `pr-review` | `dhpk-pr-review` | `change-verdict` / `pr` | `capability-family-consolidation` | `0.52.0` |
| `security-review` | `dhpk-security-review` | `change-verdict` / `security` | `capability-family-consolidation` | `0.52.0` |
| `test-review` | `dhpk-test-review` | `change-verdict` / `tests` | `capability-family-consolidation` | `0.52.0` |
| `doc-review` | `dhpk-doc-review` | `change-verdict` / `docs` | `capability-family-consolidation` | `0.52.0` |
| `risk-assess` | `dhpk-risk-assess` | `change-verdict` / `risk` | `capability-family-consolidation` | `0.52.0` |
| `code-explore` | `dhpk-codebase-exploration` | `code-trace` / `explore` | `capability-family-consolidation` | `0.52.0` |
| `bug-investigation` | `dhpk-root-cause-investigation` | `code-trace` / `diagnose` | `capability-family-consolidation` | `0.52.0` |
| `git-investigate` | `dhpk-git-history-investigation` | `code-trace` / `history` | `capability-family-consolidation` | `0.52.0` |
| `tool-routing` | `dhpk-tool-routing` | `code-trace` / `select-tool` | `capability-family-consolidation` | `0.52.0` |

## 已整併的能力

三組重疊能力改為合併，而不是把 alias 保留成獨立 skill：

| 舊 skills | 目前 public skill | 保留內容 |
|---|---|---|
| `code-explore`、`code-investigate`、`codex-explain` | `dhpk-codebase-exploration` | symbol/flow 探索、深度可調的說明、可選第二觀點 |
| `codex-cli-review` | `dhpk-change-review` | hardened CLI backend、merge-base diff 固定、standards/spec/security/test 軸線；預設不使用 MCP |
| `software-architecture` | `dhpk-module-design` | deep-module 詞彙、deletion test、interface/test seam、architecture handoff |

其他保留 skill 也全部取得 `dhpk-` public name。Stable inventory `id` 與 `name`
刻意分離，因此未來重新命名不會破壞 receipt ownership。

## 整併後的 hooks 與 commands

預設 hook surface 現在只有五項明確責任：

1. 保護敏感路徑的編輯。
2. Bash 前合併 shell safety 與 Git/review-debt 檢查。
3. 路由 post-edit review sentinel。
4. Session start 時驗證並啟用設定的 module。
5. Subagent stop 時核對 reviewer evidence。

Formatting、lint、Docker probe、prompt hint、session snapshot
與其他 advisory 工作都改為 consumer 明確啟用的 extension，而非預設 hook。見
[Hook extension model](./hook-extension.zh-TW.md)。

Command 一律保留 `/dhpk:<name>` namespace（Claude）。Cursor 使用產生的 command。
Codex 任務路由使用明確的 `$flow-drive` family，沒有 `/dhpk:do`。主要入口為：

- `$flow-drive --mode route|implement <task>`：Codex routing 或 implementation。
- `/dhpk:flow-drive --mode route|implement <task>`：Claude 明確呼叫。
- `/dhpk:change-verdict --mode <code|pr|security|tests|docs|risk>`：唯讀 review variants。
- `/dhpk:precommit`，需要時搭配 `--fast`。
- `/dhpk:setup --install hooks|rules|scripts|all`：設定與 asset 安裝。

上述五個 `0.47.0` retirement 與九個 `0.52.0` Codex MCP capability retirement 都不發布
discovery 或 compatibility alias。若另有文件化的相容期限而保留無關 command alias，它
不是 retired skill record，也不能取代上述任何名稱。

## 升級 Claude marketplace 安裝

```bash
claude plugin update dhpk@dhpk
```

啟動新的 Claude session 或執行 `/reload-plugins`。確認 `/dhpk:setup`、
`/dhpk:flow-guide` 與 `/dhpk:harness-audit` 都能解析。Marketplace 不會更新專案本地複製的
舊 dhpk skill；只有在確認它們已重複且有版控或其他可恢復方式後才移除。

## 升級專案本地 Codex projection

更新 Claude plugin 後，在專案根目錄執行：

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --migrate --update
```

Schema-v3 receipt 會記錄每個 managed skill、agent 與 supporting asset 的 stable id、
public name、destination、source、mode 與 fingerprint。Migration 只接管內容未變更且
完全吻合的 legacy destination；使用者自有、已編輯、重新指向、格式錯誤、無法判定
或 collision 的內容一律保留並回報。

可用操作：

| Flag | 契約 |
|---|---|
| `--copy` | Materialize 實體檔；適合 plugin root 可能消失的可攜情境。 |
| `--update` | 依目前 plugin root 對齊 receipt-owned entry。 |
| `--migrate` | 接管完全吻合且未變更的 legacy destination，重新命名為目前 public name。 |
| `--uninstall` | 只移除未變更且 receipt-owned 的 entry；保留已編輯、orphan 與無關檔案。 |
| `--force` | 只略過 project-root heuristic；永遠不繞過 ownership 或 filesystem safety。 |

不要刪除整個 `.codex/`，其中可能有專案自有的 agent、skill、MCP 設定與 hook。

## 驗證

維護者應執行：

```bash
node scripts/ci/validate-distribution.js
node scripts/ci/validate-openai-metadata.js
bin/dhpk distribution codex-native verify --json
node tests/documentation-platform-parity.test.js
node tests/run-all.js
```

預期拓撲由 inventory 管理 canonical package 數量、31 個 module 與 Codex project/native
項目（可呼叫 skill 加上內部 transport 與 dispatch-context runtime）；上述九個 MCP
capability identity 只存在 ledger，不計入任何 active count。相對 symlink 只能出現在
module/Codex projection，native package 必須零 symlink。

## Rollback

遷移前先 commit 或 snapshot `.codex/` 與 receipt。若 migration 回報 collision，請勿
強制刪除；還原 snapshot 或處理特定的 user-owned destination，再重跑
`--migrate --update`。若要停止 dhpk 專案同步，執行 `--uninstall`；它會保留已修改與
無關的 entry。

若遷移後 Codex capability regression，請 pin 仍帶有 MCP grant 的最後相容 `0.51.0`
release。不要在目前 release 重新引入 hidden MCP fallback，也不要重建已退休 identity。

Canonical source 與產生出的 native package 不可平行手動修改。只編輯
`skills/<public-name>/`，重新產生 native package、驗證，再將 source 與 generated artifact
一起提交。
