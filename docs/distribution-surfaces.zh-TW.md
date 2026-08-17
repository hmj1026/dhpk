# Distribution surfaces — lifecycle、publication 與 host 限制

> **語言**：[English](./distribution-surfaces.md) · **繁體中文**

本文件說明 dhpk 如何決定每個 skill/module 會進入哪個 consumer surface，以及各
host 能與不能過濾的內容。所有數值與歸屬以
`manifests/distribution-inventory.json` 為 SSOT。

精確安裝命令、支援層級、status vocabulary、consumer evidence 與 rollback 請以
[平台安裝 SSOT](./platform-installation.zh-TW.md)為準。
Projection 與 ownership 決策記錄於
[ADR-0009](adr/0009-distribution-projection-and-orchestration-ownership.md)。

## Lifecycle model

每個 consumer-reachable skill 與 module 只允許一個 lifecycle：

| Lifecycle | 含意 |
|---|---|
| `promoted` | 廣泛適用的核心 workflow skill。 |
| `optional` | Opt-in stack module skill 或 module 本身。 |
| `experimental` | 尚未對目標 surface 完成 host 驗證。 |
| `deprecated` | 已離開 promoted publication，但 compatibility window 期間保留 canonical source 與 migration guidance。 |

Publication surface 包含 `claude-core`、`claude-module`、`codex-sync`（支援的
`install-codex-skills.sh` 路徑）、`codex-native`（實驗性的 marketplace package）、
`agent-plugin`、`cursor-plugin` 與 `cursor-sync`（支援的
`install-cursor-harness.sh` project-local 路徑）。`agent-plugin` 與
`cursor-plugin` 分別代表 Agent Plugin 與 Cursor publication package；
`cursor-sync` 是 consumer `.cursor/` 的 Codex 對應路徑。shared portable skill
ownership 與 Cursor-native overlay 規則見下節。
目錄位置與 README prose 不是權威來源。`validate-distribution.js` 會比對 canonical
package、module catalog、Codex metadata 與 inventory。

同一份 inventory 的 `supporting_assets` 也管理 Codex projection 的 trap sheet、
contract 與 execution policy。Installer 會把每個 materialized asset 記錄到 schema-v3
`.codex/.dhpk-installed.json`，確保乾淨 consumer projection 中的 agent reference 可達。

## Projection contract 與 rollback

所有已 cutover 的 publication surface 都遵循同一條 ownership 流程：

```text
inventory projection_contract
  -> compileDistribution（純 immutable plan）
  -> surface adapter 只 render 已規劃輸出
  -> ProjectionArtifactStore staging 並 atomic publish
  -> verifyDistribution(stage) 回傳 plan/artifact-bound evidence
```

`manifests/distribution-inventory.json` 是 selection、lifecycle、surface
membership、physical owner、transform、destination、verification stage 與 symlink
policy 的 SSOT。Adapter 只能產生 consumer-native bytes 與觀察結果，不能自行加入
entry、寫檔、重新擁有 artifact 或提升支援等級。`ProjectionArtifactStore` 是 managed
projection tree 的唯一 writer；staging 或驗證失敗時，上一份 accepted artifact 必須
保持不變。Rollback 應透過同一個 CLI/store 路徑恢復上一份 accepted artifact，不要直接
編輯 generated tree 或改動 canonical source。

Symlink policy 是 closed、fail-closed vocabulary：`forbid`、`contained-relative`、
`declared-source-relative`。預設是 `forbid`；contained link 必須留在 artifact owner
內，declared-source-relative link 必須是相對、由 plan 宣告、由 destination root 擁有，並
解析到 plan 綁定的 canonical source root。保留的 `codex-sync` 與 `cursor-sync`
compatibility route 可使用最後一種；absolute 或未宣告 symlink 一律拒絕。

Verification 必須綁定 stage。`structural` 與 `package` 的 `PASS` 只代表已檢查的
artifact/package claims；`consumer-runtime` 必須有真實 consumer probe。前兩者不能宣稱
runtime support，也不能讓 experimental surface 自動畢業。Evidence verdict 維持封閉
集合：`PASS`、`FAIL`、`NOT_RUN`、`NOT_CONFIGURED`、`SKIP_INCOMPATIBLE`、`BLOCKED`、
`UNAVAILABLE`。

## Standard Agent Plugin 與 Cursor native ownership

Platform capability matrix 讓相同的 portable skill 只有一個 physical publication
owner：`plugins/dhpk-agent/skills/`。Standard Agent Plugin 擁有這份 generated tree；
`plugins/dhpk-cursor/` 預設只放 Cursor-native rules、agents、commands、hooks 與
variables。Cursor provenance 會記錄 shared stable IDs 與
`plugins/dhpk-agent/skills/` source，但不建立第二份 `skills/`。只有明確 matrix row
使用 `projection_mode: overlay`、指定 stable IDs，並記錄 transform、fallback 與獨立
fingerprint 時，才允許 Cursor-specific copy。如此 shared portable skills 只有一個
更新／rollback owner，而 Cursor-native files 由另一個 owner 獨立管理。

## 目前 Claude publication

`scripts/ci/gen-claude-manifest.js` 從 inventory 產生 `.claude-plugin/plugin.json` 的
skill root。現在是一個 registered directory root，下面有 102 個 inventory-eligible skill ID。
所有 package 都扁平位於 `skills/dhpk-<name>/`；module `skills/` 只是相對 symlink
projection。

Claude manifest 註冊的是 skill **directory root**，不是逐 skill allowlist。因此：

- 無法只隱藏同一 root 裡的一個 deprecated skill。
- 若某個 root 全部 deprecated，generator 可以移除整個 root。
- `userConfig.modules` 只控制 runtime hook/guidance activation；host 仍會列出所有
  module skill description。

## Two-stage deprecation

第一階段在 inventory 將 lifecycle 設為 `deprecated`，並填入 `since`、
`compatibilityWindowEnds` 與 `migrationNote`。Canonical package 在相容期間保留。
第二階段只有在 window 結束且 reference scan 確認無使用者後，才能由後續受審查
變更刪除 source。Validator 不會自動依日期刪除任何內容。

## Codex project sync

支援的 Codex consumer 路徑是：

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```

目前 `codex/skills/` 有 15 個指向 canonical `skills/` 的相對 symlink。專案同步可
選預設 symlink 或 `--copy` 實體檔，並以 schema-v3 receipt 管理 `--update`、
`--migrate` 與 `--uninstall`。`--force` 只略過 project-root heuristic，不會繞過
ownership 或 filesystem safety。完整操作見
[`basic-operations.zh-TW.md`](./basic-operations.zh-TW.md#同步-codex-cli-內容)。

## Codex native plugin package

Native marketplace artifact 位於 `plugins/dhpk/`，由
`gen-codex-native-package.js` 從 inventory 的明確 `codex-native` surface 產生。它
包含同一組 15 個 public skill，但全部是追蹤中的實體檔，零 symlink；root 與 wrapper
manifest 都解析到這一份 physical tree。

三個獨立 release gate 分別驗證：

1. **SOURCE**：inventory 與 canonical source。
2. **PACKAGE**：tracked artifact layout、版本、provenance、fingerprint 與 deterministic drift。
3. **CONSUMER**：用真實 Codex CLI 安裝 tracked artifact，刪除 source checkout，再確認 cache 內每個 skill 仍是可發現的實體檔。

[Issue #88](https://github.com/hmj1026/dhpk/issues/88) 的 symlink-mirror 與 parent-relative
escape 失效模式目前已在正式 manifest/package 上通過結構與 consumer 驗證。不過這
只是畢業的必要證據，不會自動改變支援等級；Codex marketplace 仍為
**experimental**，直到另有獨立核准的 graduation decision。正式工作仍優先使用
project-local sync。

## 維護與驗證

只編輯 canonical `skills/dhpk-*/` 與 inventory，不直接手改 module/Codex symlink
projection 或 native package。Native package 必須重新產生並與 source 一起提交：

```bash
node scripts/ci/gen-codex-native-package.js plugins/dhpk --version=<version>
node scripts/ci/validate-distribution.js
node scripts/ci/validate-openai-metadata.js
node scripts/ci/verify-codex-native-package.js plugins/dhpk
node tests/run-all.js
```

完整 deprecation schema、fingerprint/provenance、duplicate-surface matrix 與 release
gate 細節以 [英文 canonical 文件](./distribution-surfaces.md) 為工程 SSOT。
