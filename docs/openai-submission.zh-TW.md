# OpenAI Public Plugin 提交

> **語言**：[English](./openai-submission.md) · **繁體中文**

## 驗收適用性

候選套件的安裝與 package 檢查，和原生 Host workflow、rendered discovery、
context-budget 研究、portal submission 及 publication 分開。一般文件或套件
變更不需要模型 session；命名的整合缺陷或明確 native 驗收要求時，才檢查受影響
Host。`NOT_RUN`、`UNAVAILABLE`、`BLOCKED` 保持真實，不會改成 `PASS`。套件產生
不代表 ChatGPT Work 已執行。十二項歷史 follow-up 見[持久處置契約](contracts/host-runtime-followup-disposition.md)。

本文件是 dhpk skills-only OpenAI Public Plugin 候選版的提交準備 SSOT。
目標是 Codex 與 ChatGPT Work 共用的公開 Plugins Directory。OpenAI 發布尚未
完成：repository 已有 builder 與候選 metadata，但目前候選版尚未上傳、核准或
發布。

## 候選版與交付狀態

Portable package 根目錄使用 `plugin.json`，並從已接受的
[marketplace catalog](./contracts/marketplace-catalog.md) 產生 `skills/`。
內容包含 15 個公開 workflow entries 與 45 個 bundled 子資源。子資源提供所屬
skill 內的條件式指引；不會另外成為公開 listing 或 selector entry。Host-only
與 withdrawn skills 會排除。Optional agent-role/custom-role 分發有獨立驗收，
不屬於此 skills-only 候選版。

候選 metadata 位於
[`manifests/openai-submission.json`](../manifests/openai-submission.json)。目前
版本是 `0.64.4`，與 repository 現行 plugin 版本一致。候選 `developerName` 依使用者
指示設為 `hmj1026`；Portal identity verification 仍是 `NOT_RUN`。
Privacy URL 是指向 repository `develop` branch 的候選連結。下方 policy 仍是草稿；
在公開 URL 指向已審閱內容之前，不可當作已發布或已核准的提交政策。

| 證據 | 目前狀態 |
|---|---|
| Builder 實作與本機結構檢查 | 已實作；見[分發面](./distribution-surfaces.zh-TW.md#openai-submission-artifact) |
| 從此 release candidate 的乾淨 checkout 產生並驗證 artifact | 此 release candidate 為 `NOT_RUN` |
| 使用該 artifact 在新 Codex 與 ChatGPT Work session 執行 workflow | `NOT_RUN` |
| 最終 rendered discovery 與 runtime-budget 驗收 | 尚未對實際安裝的 artifact 與 receipt 留證，維持 `NOT_RUN` |
| Publisher identity 與必要 policy attestations | `NOT_RUN` |
| Portal upload、平台掃描、submission、approval 與公開發布 | `NOT_RUN` |
| 公開目錄可用性 | `NOT_PUBLISHED` |

一次性舊安裝 cutover executor 尚未交付。本文件不會遷移、移除或協調現有的 Codex
sync/native installation 或其他 Host 狀態。仍需使用目前相容流程時，依照既有文件
操作；更改流程前要另行評估 cutover。

## 建置與驗證候選套件

從乾淨且已提交的 checkout 執行產生，`HEAD` 必須是預期的 release candidate。
輸出目錄必須是 checkout 外的新實體目錄；若要重用既有路徑，必須先確認其中是本
builder 產生且帶有效 receipt 的 artifact。

```bash
bin/dhpk distribution openai-submission generate \
  --manifest manifests/openai-submission.json \
  --output /absolute/path/outside/dhpk/dhpk-openai-submission \
  --json

bin/dhpk distribution openai-submission validate \
  --output /absolute/path/outside/dhpk/dhpk-openai-submission \
  --json

bin/dhpk distribution openai-submission verify \
  --output /absolute/path/outside/dhpk/dhpk-openai-submission \
  --json
```

產生程序會發布 `package.zip` 與 `provenance.json`。Receipt 綁定來源 commit/tree、
selection、archive digest 與解開後檔案的 fingerprints。`validate` 與 `verify` 會依
目前公開 selection 檢查 ZIP 與 receipt；成功只代表本地結構／套件證據，不代表
consumer 執行、safety scans、portal acceptance 或 publication。Receipt 是完整性紀錄，
不是經簽署的 publisher attestation。

要比較重複建置，請在同一乾淨 commit 上執行兩次，每次使用不同且不存在的輸出目錄，
再比較兩個 `package.zip` 的 SHA-256 digest。輸出必須留在 source tree 外。不要在
dirty checkout 執行 `generate`：只要 checkout 有 tracked 或 untracked 變更，provenance
產生就會 fail closed。

Generator 只接受完整公開 catalog，不支援部分 `--profile`、`--skill` 或
`--standalone` selector。不可把 MCP server、apps、hooks、credentials、reviewer-only
備註或 test credentials 加入 skills-only artifact。Listing 與 asset 欄位會依目前
portable manifest contract 檢查；圖片實體是否存在、是否為正方形，以及最終 portal
rendering 仍須在 release candidate 上驗證。

## 安裝與開發來源

公開 listing 通過核准並出現在 universal directory 後，使用者可從支援的 Codex 或
ChatGPT Work surface 開啟 Plugins Directory，搜尋 **DHPK** 並在該處安裝。移除公開
plugin 時使用同一 plugin manager。安裝後請建立新對話，再評估 skills。公開 listing
會在支援的 Codex 與 ChatGPT surface 共用；每個 Host 仍須各自留下 workflow 執行證據。

使用 Codex CLI 時，執行 `codex`、開啟 `/plugins`、搜尋 DHPK，再選擇
**Install plugin**。在 ChatGPT 中開啟 Plugins Directory、搜尋並加入 DHPK，之後再開始
新的 Work 對話。

Repository 或 personal marketplace 是開發／測試來源，不是公開 listing，也不是 dhpk
日常使用的 OpenAI route。Codex CLI 使用 `codex plugin marketplace add` 管理已設定的
marketplace；在 development marketplace 中，使用 `codex plugin add` 與
`codex plugin remove` 管理 plugin。這些命令不會發布公開 listing。Local marketplace
在各 Host 的可用性可能不同，不可描述成已發布的 consumer 安裝方式。

支援等級與相容路徑見[平台安裝](./platform-installation.zh-TW.md#openai-skills-only-public-plugin)，
現行與相容流程見[基本操作](./basic-operations.zh-TW.md#分發面政策)。

## Release checklist

將下列證據分開記錄，並且只有在實際執行後才更新狀態：

1. 從指定乾淨 release commit 建立完整 catalog，執行上述 `generate`、`validate` 與
   `verify` 命令，保存 ZIP digest 與 receipt。
2. 透過支援的 Codex 測試方式，在新的 Codex session 安裝同一 ZIP。
   記錄 client version、artifact digest、可見 public skill names 及代表性 workflow
   結果。Children 必須仍是資源，不能額外成為 selector。
3. 從已安裝候選版量測 rendered listing/discovery 與實際 Host budget。
   [`manifests/discovery-budgets.json`](../manifests/discovery-budgets.json) 的靜態上限是
   規劃限制，不是 runtime 驗收。
4. 在 OpenAI portal 確認已驗證的 developer identity 與必要 account/policy attestations。
5. 公開經審閱的 privacy policy，確認 support 與 website URL 都可公開存取。若 package
   metadata 或 assets 有變動，重新產生並驗證候選版。
6. 上傳 ZIP、完成平台 scans、送交審核、記錄平台決定，並確認核准版本已出現在公開目錄。

ChatGPT Work consumer verification 是之後發布前的獨立必要條件，目前狀態為
`NOT_VERIFIED`（`NOT_RUN`）；它不屬於目前的 Codex candidate acceptance。通過驗證前，
不可宣稱 ChatGPT Work 已支援或已通過發布驗收。

目前 checkpoint 的第 1–6 項對此 release candidate 都是 `NOT_RUN`；Privacy policy
URL 尚未指向已發布政策，候選版狀態為 `NOT_PUBLISHED`。不可用生成的 ZIP、本機
marketplace entry、catalog count 或 package validator 代替這些 gate。

## 官方參考資料

- [Package your plugin](https://developers.openai.com/plugins/build/plugins)：portable
  root manifest 與 marketplace source 的界線。
- [Plugin quickstart](https://developers.openai.com/plugins/quickstart)：ChatGPT 與
  Codex 共用目錄及安裝流程。
- [Upload and submit your plugin](https://developers.openai.com/plugins/deploy/submission)：
  提交材料與 listing 欄位。
- [Submission errors](https://developers.openai.com/plugins/deploy/submission-errors)：
  最終 metadata、圖片、掃描與 publisher identity 檢查。
