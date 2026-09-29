# Review Gate Migration evidence 蒐集機制調查（Issue #374 CUTOVER 前置）

## 問題描述

- **背景**：ADR-0016 規定，`DUAL_ENFORCE` → `CUTOVER`（及後續 `RETIRE`、
  `CLEANUP`）都需要一份 maintainer Human Authority receipt，且這份
  receipt 必須 bind 到「current phase、evidence bundle、target phase」。
  Issue #374 明確 blocked by 這份 receipt；receipt 不能由 agent 偽造。
- **要回答的問題**：如果 maintainer 現在發布新版本、在真實工作
  （commit / PR）上實際運作，之後要去哪裡看、跑什麼指令，才能知道
  累積了多少 evidence、是否已經滿足 exit-gate 條件？
- **調查範圍**：只讀程式碼與 ADR，不修改 `migration-coordinator.js`
  或任何其他原始碼；不核發、不偽造任何 receipt。
- **環境**：`develop`，dhpk HEAD `f05a287d`（PR #389 merge 後）；
  2026-09-07。

## 結論摘要

**蒐集/儲存機制存在，但完全沒有被接到真實運作路徑上；查詢工具不存在。**

1. Receipt 的持久化格式（content-addressed JSON store）已經實作完成，
   但 `new MigrationCoordinator(...)` 和 `new ReceiptStore(...)` **在
   `scripts/` 與 `.claude/` 底下除了測試以外，沒有任何地方被實際
   instantiate**（見下方 Phase 2）。也就是說，即使現在發新版本上線，
   目前的程式碼也不會自動開始寫入 migration-observation receipt——
   相關的 platform adapter（`git-provider-review-gate-adapter.js`、
   `ci-review-gate-adapter.js`、`workflow-coordinator.js`）雖然
   `require` 了 `migration-coordinator.js` 的 helper function，但沒有
   任何一處呼叫 `record()` 或 `transition()` 把真實 review 事件寫入
   receipt store。
2. 對應地，磁碟上目前沒有 `.dhpk/review-gate/v1/`（ReceiptStore 的
   預設 root）——這比我在主對話中先前的判斷更精確：先前只搜尋了
   `.review-gate*` / `.migration*`，沒搜到是因為實際路徑是
   `.dhpk/review-gate/v1`（且 `.gitignore` 第 1 行就排除
   `.dhpk/review-gate/`），而不是因為搜錯範圍。
3. Exit-gate 的量化條件（≥20 accepted outcomes、zero unsafe clearance、
   zero cross-identity receipt reuse、zero missed required review）在
   `migration-coordinator.js` 裡只有**單筆 receipt 的 schema 驗證**
   （`validateAcceptedOutcomeCost`），**沒有任何跨 receipt 的 cohort
   聚合或 exit-gate 計算函式**。要知道「目前累積了幾筆 accepted
   outcome、是否達標」，現狀是必須自己寫程式讀遍 receipt store 裡的
   `migration-observation` receipts 去算，沒有現成工具。
4. 查詢面只有一個 in-process JS API：
   `MigrationCoordinator.inspect({ workId })`（單一 workId 的狀態），
   沒有任何 CLI、`package.json` script、或 bin entry point 可以查詢
   或彙總全體 evidence。ADR-0017 有提到「a thin CLI facade」的設計
   意圖，但目前程式碼裡不存在。

## Phase 1 — Receipt 持久化位置與格式

- `scripts/lib/review-gate-receipt-store.js:185-204`：
  `class ReceiptStore` constructor 預設
  `root = path.resolve('.dhpk/review-gate/v1')`，並在建構時
  `ensurePhysicalDirectory(path.resolve(root))`。
- `scripts/lib/review-gate-receipt-store.js:562`：event 序列存於
  `<root>/works/<workId>/events/<revision padded to 12 digits>.json`。
- `scripts/lib/review-gate-receipt-store.js:571`：content-addressed
  物件（event 與 receipt 本體）存於
  `<root>/objects/sha256/<hash 前2碼>/<hash>.json`。
- `scripts/lib/review-gate-receipt-store.js:498-514`：
  `_writeObject(value, digest)` / `_readObject(digest)` 就是實際寫入
  /讀取這些 JSON 檔案的低階方法；`_replay(workId, expectedIdentity)`
  （`:411`）依序重放某個 workId 底下所有 event/receipt 得到目前狀態。
- `.gitignore:1`：`.dhpk/review-gate/` 已被排除在版本控制外——這是
  設計上的 local/ephemeral 狀態，不會隨 repo 一起發布或同步。

## Phase 2 — 什麼會觸發 migration-observation receipt 被寫入

- `scripts/lib/migration-coordinator.js:1167`：
  `transition({ expectedRevision, expectedChainDigest, event, receipt,
  authorityReceipt })` 是唯一會推進 Migration Phase 的方法；
  `record(...)`（推斷自 class 定義列表）是寫入
  `migration-observation` kind receipt 的方法。
- 消費 `migration-coordinator.js` 的檔案，排除 `tests/`：
  - `scripts/lib/workflow-coordinator-evidence.js:16` ——
    `require('./migration-coordinator')`，並在 `:20,464,487,723,756`
    處理 `migration-observation` receipt 的 schema 與過濾邏輯。
  - `scripts/lib/review-gate-conformance.js:9` —— 只在註解中提到
    `MigrationCoordinator`，用來說明 platform adapter「structurally
    cannot promote」一個 phase（即 conformance 測試在斷言這個安全
    不變量，不是在寫入真實 receipt）。
- `workflow-coordinator-evidence.js` 本身被以下檔案 require（排除
  `.claude/artifacts/` 產出物與 `tests/`）：
  `git-provider-review-gate-adapter.js`、
  `review-gate-receipt-bundle.js`、`workflow-coordinator.js`、
  `ci-review-gate-adapter.js`。
- **關鍵發現**：`grep -rn "new MigrationCoordinator\|new ReceiptStore"
  scripts/ .claude/`（排除 `tests/`）**沒有任何匹配**。這代表上面
  這些 adapter 雖然拉進了 migration-coordinator 的 schema/validation
  helper，但目前沒有任何一條真實執行路徑會建立 `MigrationCoordinator`
  或 `ReceiptStore` 實例、進而呼叫 `record()`/`transition()` 把一次
  真實的 Claude/Codex/CI/Git-provider review 事件轉換成
  `migration-observation` receipt 並寫進 `.dhpk/review-gate/v1/`。
  換句話說：**Migration Coordinator 的資料模型與驗證邏輯已經完工並被
  單元測試覆蓋，但還沒有被「接線」進任何 production adapter 的實際
  呼叫路徑。**

## Phase 3 — Accepted-Outcome Cost / cohort exit-gate 計算

- `scripts/lib/migration-coordinator.js:55-58`：
  `ACCEPTED_OUTCOME_COST_FIELDS = ['schema', 'observationId',
  'acceptedOutcome', 'metrics', 'telemetryFailures',
  'telemetryFailureCount', 'telemetryStatus', 'retirementEligible']`。
- `scripts/lib/migration-coordinator.js:59-62`：
  `ACCEPTED_OUTCOME_COST_METRICS = ['modelTokens', 'dispatchCount',
  'semanticReviewCount', 'remediationRounds', 'humanTurns', 'elapsedMs',
  'falseBlockCount', 'receiptReuseCount']`——這對應 ADR-0016 提到的
  model tokens / dispatch count / semantic review count / remediation
  rounds / human turns / elapsed time / receipt reuse / false blocks。
  ADR-0016 另外提到的「unsafe clearance」「missed required review」
  「post-merge escapes」**不是這個 metrics schema裡的欄位**，它們是
  由其他 invariant 驗證函式把關的（例如
  `validateObservationLiveness`、`validateObservationEvidenceBinding`、
  `validateTransitionAgainstObservation`，以及「安全分歧一律自動回退
  一個 Phase」的規則），而不是 cohort 比較的量化欄位。
- `scripts/lib/migration-coordinator.js:321`：
  `validateAcceptedOutcomeCost(cost)` 只驗證**單一** receipt 的欄位
  形狀與型別是否合法（例如 `telemetryFailures` 陣列長度 ≤ 20——這是
  巧合的數字，跟 exit-gate 的「≥20 筆 accepted outcome」門檻無關，
  單純是防止單筆 receipt 過大的上限）。
- 全檔案 `grep -n "cohort\|exitGate\|exit_gate"` **沒有任何匹配**。
  **不存在**任何函式會讀取 receipt store 裡所有
  `migration-observation` receipts、依 Material Risk cohort 分組、
  加總 accepted outcome 筆數、比較 Accepted-Outcome Cost、或判斷
  exit-gate 是否達標。ADR-0016 裡的「至少 20 筆 accepted outcomes」
  等條件目前只是**文件裡的政策敘述**，沒有對應的程式碼實作去自動
  計算或驗證。

## Phase 4 — 是否已有查詢/彙總 CLI

- `scripts/lib/migration-coordinator.js:1337-1338`：
  `MigrationCoordinator.inspect({ workId, waveId, expectedRevision,
  expectedChainDigest })` 呼叫 `this.receiptStore.inspect(...)`
  （`review-gate-receipt-store.js:593`），回傳**單一 workId** 的
  derived 狀態。這是一個 in-process JavaScript API，需要自己寫一小段
  Node script 呼叫它，不是可以直接在 shell 打的指令。
- 搜尋 `scripts/` 底下的 CLI/bin 慣例
  （`cli-role-resolver.js`、`check-cross-cli-drift.sh`、
  `resolve-feature-cli.js`）與 `package.json` 的 `scripts` 欄位，
  **沒有任何一個是針對 review-gate receipt store 或 migration
  coordinator 的查詢、replay、status 指令**。
- ADR-0017（`:35`）提到設計意圖是「a thin CLI facade」包在
  `ReviewGate` / `ReceiptStore` 之上，但這個 facade **目前不存在**於
  程式碼裡——這是 ADR 記錄的未來方向，不是已完工的功能。

## Phase 5 — ADR 設計意圖對照

- **ADR-0013**（migrate Sentinel to evidence receipts）：確立
  Evidence Receipt 作為 review 判斷與證據綁定的載體，是後續
  Migration Coordinator 依賴的基礎資料型別。
- **ADR-0015**（derive workflow state from typed receipts）：確立
  workflow 狀態應該從 typed receipt 重放推導，而不是可變旗標——這解釋
  了為什麼 `ReceiptStore._replay()` 是唯一得到「目前狀態」的方式，
  而不是讀一個簡單的狀態檔。
- **ADR-0016**：本次調查的核心依據，見上方摘要與 Phase 3。
- **ADR-0017**（implement Review Gate as a local event module）：
  定義了 `ReviewGate.inspect(workId | waveId)`、`ReceiptStore`
  persist/replay 的模組邊界，並提到「thin CLI facade」的規劃，
  以及「不要加一個 manual clear command——因為那會重新造出一條
  unaudited bypass」（`:123`）的明確反對意見，佐證了「不要為了方便
  查詢就繞過 receipt/replay 模型去手動塞資料」的設計立場。
- `docs/contracts/review-lifecycle.md`：內容偏向 contract/schema
  定義與 redaction 規則，沒有提到操作面的查詢流程或 runbook。

## 實務上 maintainer 現在能做什麼（純描述，非程式碼變更提案）

1. **發新版本、開始用 DUAL_ENFORCE 實際運作**這件事本身沒有問題，但
   現況下**不會自動產生 evidence**——因為 Phase 2 發現的「adapter 拉
   了 helper function，卻沒有任何地方實際 instantiate
   `MigrationCoordinator`/`ReceiptStore`」。換句話說，光是「上線
   運作」不足以累積 #374 需要的 evidence bundle；還需要先有人把
   Migration Coordinator 接到某個真實會被觸發的路徑上（這是一個
   程式碼變更，但不在本次調查範圍內，也不是本文件要建議的事——只是
   如實指出這個缺口存在）。
2. 如果之後確實有 receipt 開始寫入 `.dhpk/review-gate/v1/`，要看
   「目前狀態」得用 `MigrationCoordinator.inspect({ workId })` 這個
   JS API（沒有 shell 指令可以直接查）。
3. 要驗證 ADR-0016 的量化 exit-gate（≥20 accepted outcomes、
   zero unsafe clearance 等），目前沒有任何自動化工具能算出這個
   數字——必須手動寫 script 讀遍 `.dhpk/review-gate/v1/works/*/events/`
   底下所有 `migration-observation` receipt 才能加總。
4. 因此，"發布新版 + 實際驗證 + 蒐集資訊" 這條路，實際卡點不是
   "要等多久"，而是"這條資料管線目前根本沒有被接通"——這是在核發
   CUTOVER receipt 之前，maintainer 需要先確認/決定的事。

## 調查進度

- [x] Phase 1: Receipt 持久化位置與格式
- [x] Phase 2: 觸發寫入的路徑（發現：目前沒有真實路徑會寫入）
- [x] Phase 3: Accepted-Outcome Cost / exit-gate 計算（發現：無聚合邏輯）
- [x] Phase 4: 查詢 CLI（發現：不存在，只有 in-process `.inspect()`）
- [x] Phase 5: ADR 設計意圖對照
