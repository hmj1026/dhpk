# Skill platform 整併與遷移

> **語言**：[English](./skill-platform-migration.md) · **繁體中文**

本指南是 collision-safe skill platform 的升級契約，適用於維護者、Claude
marketplace 使用者、會把 dhpk 同步到 `.codex/` 的專案，以及同時安裝 Matt
Pocock 或其他全域 skill 的使用者。

目前 Codex/Cursor 安裝路徑與 rollback 邊界請以[平台安裝 SSOT](./platform-installation.zh-TW.md)為準。

## 目前契約

| 關注點 | 目前實作 |
|---|---|
| Canonical source | `skills/dhpk-<name>/` 下 103 個扁平 package |
| Public identity | 每個 dhpk skill 名稱都以 `dhpk-` 開頭 |
| Inventory SSOT | `manifests/distribution-inventory.json` schema v2 |
| Module projection | `modules/*/skills/` 下 37 個相對 symlink |
| Codex 專案 projection | `codex/skills/` 下 15 個相對 symlink |
| Codex native package | `plugins/dhpk/skills/` 下 15 個實體 package，零 symlink |
| Codex 專案 receipt | `.codex/.dhpk-installed.json` schema v3 |
| 預設 hooks | `PreToolUse`、`PostToolUse`、`SessionStart`、`SubagentStop` |
| Learning | `dhpk-continuous-learning-v2` 為 opt-in |

目錄位置與 README 清單都不是權威來源。Inventory 管理 stable id、public name、
lifecycle、module 與 publication surface；validator 會將每個 projection 與它對齊。

## 呼叫語法

不同 host surface 刻意使用不同語法：

| Surface | 語法 | 範例 |
|---|---|---|
| Claude command | `/dhpk:<command>` | `/dhpk:harness-audit` |
| Claude plugin skill | `/dhpk:<public-skill-name>` | `/dhpk:dhpk-change-review` |
| Codex skill | discovery 後使用 `$<public-skill-name>` | `$dhpk-change-review` |

Claude skill invocation 中重複的 `dhpk` 是刻意的。第一個是 Claude plugin
namespace；第二個是全球 collision-safe skill 名稱的一部分。Command 只使用 plugin
namespace 與 command 檔名。

## 已整併的能力

三組重疊能力改為合併，而不是把 alias 保留成獨立 skill：

| 舊 skills | 目前 public skill | 保留內容 |
|---|---|---|
| `code-explore`、`code-investigate`、`codex-explain` | `dhpk-codebase-exploration` | symbol/flow 探索、深度可調的說明、可選第二觀點 |
| `codex-cli-review` | `dhpk-change-review` | MCP 與 hardened CLI backend、merge-base diff 固定、standards/spec/security/test 軸線 |
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

Formatting、lint、Docker probe、prompt hint、session snapshot、continuous learning
與其他 advisory 工作都改為 consumer 明確啟用的 extension，而非預設 hook。見
[Hook extension model](./hook-extension.zh-TW.md)。

Command 一律保留 `/dhpk:<name>` namespace。重疊工作流收斂到四個主要入口：

- `/dhpk:do`：任務路由。
- `/dhpk:codex-review --scope ...`：Codex review variants。
- `/dhpk:precommit`，需要時搭配 `--fast`。
- `/dhpk:setup --install hooks|rules|scripts|all`：設定與 asset 安裝。

若仍內附薄的相容 alias，只保留一個 minor release；command index 會標記已退休的
install alias，新文件不得再使用。

## 升級 Claude marketplace 安裝

```bash
claude plugin update dhpk@dhpk
```

啟動新的 Claude session 或執行 `/reload-plugins`。確認 `/dhpk:setup`、
`/dhpk:do` 與 `/dhpk:harness-audit` 都能解析。Marketplace 不會更新專案本地複製的
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
| `--migrate` | 接管完全吻合且未變更的 legacy destination，重新命名為 public `dhpk-*`。 |
| `--uninstall` | 只移除未變更且 receipt-owned 的 entry；保留已編輯、orphan 與無關檔案。 |
| `--force` | 只略過 project-root heuristic；永遠不繞過 ownership 或 filesystem safety。 |

不要刪除整個 `.codex/`，其中可能有專案自有的 agent、skill、MCP 設定與 hook。

## 驗證

維護者應執行：

```bash
node scripts/ci/validate-distribution.js
node scripts/ci/validate-openai-metadata.js
node scripts/ci/verify-codex-native-package.js plugins/dhpk
node tests/documentation-platform-parity.test.js
node tests/run-all.js
```

預期拓撲為 103 個 canonical skill、31 個 module、15 個 Codex project/native skill；
相對 symlink 只能出現在 module/Codex projection，native package 必須零 symlink。

## Rollback

遷移前先 commit 或 snapshot `.codex/` 與 receipt。若 migration 回報 collision，請勿
強制刪除；還原 snapshot 或處理特定的 user-owned destination，再重跑
`--migrate --update`。若要停止 dhpk 專案同步，執行 `--uninstall`；它會保留已修改與
無關的 entry。

Canonical source 與產生出的 native package 不可平行手動修改。只編輯
`skills/dhpk-*/`，重新產生 native package、驗證，再將 source 與 generated artifact
一起提交。
