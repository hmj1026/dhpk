---
name: bug-investigation
description: "Systematic 5-phase bug investigation workflow for unexpected behavior, test failures, performance regressions, data inconsistencies, and root cause tracing. Use when users ask to investigate/trace bugs or data flow (e.g., bug investigation, 測試失敗, 效能異常, 調查 Bug, 追蹤資料流, root cause analysis). Not for direct implementation-only tasks where root cause is already confirmed. Output: phase-based investigation report with evidence, root cause, and fix options."
---

# Bug Investigation Skill

## 概述

一套系統化方法，用於調查複雜程式碼中的錯誤與異常行為。此技能包含五個階段：
1. **問題釐清** - 理解回報的問題與影響範圍
2. **證據蒐集** - 從資料庫與日誌收集可驗證的證據
3. **根因分析** - 追蹤資料流找出來源與分歧點
4. **修正方案設計** - 提出與評估解決方案並形成決策依據
5. **知識文件化** - 留存可重用的知識與調查結果

## When NOT to Use

- 已確認問題成因且使用者只要求直接實作小型修正
- 任務是一般 code review / doc review，沒有 root cause 調查需求
- 純新功能開發且沒有異常行為、資料不一致或測試回歸跡象

## 核心鐵律

```
未完成 Phase 1-3（尤其 Phase 3），不得提出修正方案或修改程式碼。
```

**強制要求**：
- 所有五個階段必須完成，不可跳過。若受阻，必須記錄原因、缺口與下一步，並在調查文件中標示未完成狀態。
- 未完成 Phase 1-3 前禁止提出修正方案或改動程式碼。
- 所有輸出文件與報告以正體中文為主；保留原始 log、程式碼與欄位名稱。

## Output

- `docs/knowledge/[feature-name]/investigation.md`（問題定義、證據、根因）
- `docs/knowledge/[feature-name]/solution-proposal.md`（方案比較、風險、推薦）
- 必要時補齊 `data-flow.md`、`key-functions.md`、`related-tables.md`
- 一段可執行的 next actions（進 OpenSpec / 補證據 / 停損）

## Verification

- [ ] Phase 1-3 證據鏈完整且可追溯
- [ ] 根因有單一假設與最小驗證結果
- [ ] Phase 4 至少提供 2 個方案與 1 個推薦方案
- [ ] 已定義後續步驟（OpenSpec 或回到前一 Phase）

## 參考

- `references/scripts.md`：工具安裝與腳本使用說明
- `references/examples.md`：調查案例與寫作模板
- `references/root-cause-tracing.md`：根因回溯追蹤技巧
- `references/defense-in-depth.md`：多層防護驗證模式
- `references/condition-based-waiting.md`：以條件為基準的等待（解決 flaky 測試）
- `references/wait-for-helper.ts`：條件等待 helper 範本（可直接複製）
- `references/phase-templates.md`：各 Phase 文件與 SQL/表格模板
- `references/checklists.md`：完整檢查清單
- `scripts/find-polluter.sh`：定位污染測試與共享狀態問題（詳見 `references/scripts.md`）

---

## Phase 1: 問題釐清

> 提示：首次使用先執行 `./scripts/check-tools.sh`（詳見 `references/scripts.md`）。

### 1.1 收集初始資訊

向使用者詢問以下資訊：
- [ ] **問題描述**：預期行為與實際行為的差異為何？
- [ ] **樣本資料**：具體的 ID、時間戳記或交易編號
- [ ] **可重現性**：問題是否能穩定重現？
- [ ] **環境資訊**：受影響的環境、系統或資料庫

### 1.2 建立調查文件

在 `docs/knowledge/[feature-name]/investigation.md` 建立調查文件，模板見 `references/phase-templates.md`。

---

## Phase 2: 證據蒐集

### 2.1 資料庫驗證

產生 SQL 查詢以驗證問題，模板見 `references/phase-templates.md`。

### 2.2 記錄發現

在 `docs/knowledge/[feature-name]/investigation.md` 中記錄資料庫證據，表格模板見 `references/phase-templates.md`。

### 2.3 識別矛盾點

尋找資料不一致的地方：
- [ ] 相關資料表的資料是否匹配？
- [ ] Log 記錄是否與交易資料一致？
- [ ] 資料中是否有時序問題？

### 2.4 跨層蒐證（多元件系統）

當流程跨越多層（前端 → API → 背景作業 → DB）時：
- [ ] 在每一層記錄「輸入」與「輸出」的資料
- [ ] 檢查設定/環境變數是否正確傳遞
- [ ] 一次收集證據以定位斷裂的層級

---

## Phase 3: 根因分析

### 3.1 追蹤資料流向

描繪資料從輸入到資料庫的完整路徑，必要時參考 `references/root-cause-tracing.md`。

### 3.2 對照可運作範例

- [ ] 找出同專案中相似且正常的流程/程式碼
- [ ] 完整閱讀，不要略過細節
- [ ] 列出所有差異（哪怕很小）

### 3.3 程式碼調查

對資料流中的每個步驟：

1. **搜尋關鍵變數** (使用專業工具):
   - 使用 ripgrep：`rg "<variable_name>" --type php --type js`
   - 使用腳本：`trace-data-flow.sh`、`search-database-queries.sh`

2. **追蹤資料來源**：
   - 哪個函式計算或提供此值？
   - 資料如何從前端傳遞到後端？
   - 使用 `analyze-function-calls.sh` 分析函式呼叫關係

3. **識別分歧點**：
   - 預期與實際行為在哪裡分歧？
   - 什麼條件導致進入錯誤的路徑？
   - 使用 `generate-flow-diagram.sh` 生成流程圖輔助分析

### 3.4 單一假設與最小驗證

- [ ] 明確寫下單一假設：「我認為 X 是根因，因為 Y」
- [ ] 設計最小修改或最小檢查來驗證
- [ ] 驗證失敗就回到 3.1-3.3 重新建立假設

### 3.5 記錄根本原因

更新 `docs/knowledge/[feature-name]/investigation.md`，模板見 `references/phase-templates.md`。

---

## Phase 4: 修正方案設計

### 4.1 建立修正方案文件（必做）

在 `docs/knowledge/[feature-name]/solution-proposal.md` 記錄修正方案與判斷依據，模板見 `references/phase-templates.md`。

### 4.2 設計解決方案選項

提出 2-3 個解決方案，並回填到 `solution-proposal.md`。

### 4.3 推薦解決方案

向使用者呈現建議：
- 推薦哪個選項？為什麼？
- 有什麼風險？
- 需要什麼測試？

### 4.4 建立失敗測試/最小重現（必做）

- [ ] 建立最小可重現案例或自動化測試
- [ ] 有測試框架時先寫 failing test
- [ ] 需要完整測試流程時使用 `tdd-guide` agent
- [ ] 若是 flaky/timeout，改用 `references/condition-based-waiting.md` 的條件等待

### 4.5 建立 OpenSpec（強制，無例外）

Phase 4 完成後**必須**進入 OpenSpec 流程，不得跳過：

```bash
/opsx:new   # 依推薦方案命名 change（kebab-case）
```

依序建立所有 artifacts：
- `proposal.md` - 根因摘要 + 推薦方案
- `design.md` - 技術決策與架構
- `specs/[capability]/spec.md` - 行為規格
- `tasks.md` - 實作檢查清單

建立完成後執行 `/opsx:apply` 按 TDD 實作。

> **鐵律：** bug-investigation 觸發 → 調查完成 → 必接 OpenSpec → 再實作。
> 不允許從 Phase 4 直接跳到程式碼修改。

### 4.6 修復連續失敗時的停損

- [ ] 已嘗試修復 2 次仍失敗：回到 Phase 1-3 重新調查
- [ ] 已嘗試 3 次仍失敗：停止再修，先討論架構/設計問題

修復涉及資料驗證時，採用 `references/defense-in-depth.md` 的多層防護。

---

## Phase 5: 知識文件化

### 5.1 檢查現有知識庫

在深入研究程式碼之前，檢查是否已有相關文件：

```bash
# 搜尋知識庫是否已有相關文件
ls docs/knowledge/
```

### 5.2 建立功能知識文件

調查完成後，記錄功能邏輯供未來參考：
建立以下文件，模板見 `references/phase-templates.md`：
- `data-flow.md`
- `key-functions.md`
- `related-tables.md`

### 5.3 更新檢查清單

檢查清單模板見 `references/checklists.md`。

---

## 關鍵原則

### 調查方法論
- **追隨資料** - 從來源追蹤數值到目的地
- **信任證據** - 資料庫記錄不會說謊
- **一次一個假設** - 先測試和驗證再前進
- **記錄一切** - 保留調查軌跡

### 溝通方式
- **全程正體中文** - 所有輸出與文件維持正體中文
- **游進式報告** - 不要等到最後才報告
- **提出澄清問題** - 與使用者驗證假設
- **解釋推理** - 幫助使用者理解分析

### 解決方案設計
- **最小變更原則** - 只修復損壞的部分
- **預防未來問題** - 考慮如何避免類似的 bug
- **完整測試** - 驗證修復不會引入新問題

## 例外處理（仍須完成 Phase 1-5）

若調查確認問題源於外部系統/環境/時序：
- **清楚記錄證據與限制**
- **在 Phase 4 設計防護**（重試、timeout、錯誤訊息、監控）
- **在 Phase 5 留下觀測點**

---

## 檢查清單總結

完整版本請見 `references/checklists.md`。
