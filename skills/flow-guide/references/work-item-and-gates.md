# Work-Item And Gates

只在下列情況讀取本檔：

- workflow type 是 `Feature Delivery` 或 `Bug Investigation & Fix`
- 需要判斷 work-item 是否 ready
- 需要說明為何 gate PASS / FAIL

## Work-Item Systems

### OpenSpec

- 使用者選擇 OpenSpec 時，依 OpenSpec 的 readiness 規則確認該 change 是否可 apply
- 沿用已有且仍適用的規格、決策與 evidence；不要另建 proposal 或 planner artifact
- apply 的必要前置結果未具備時，只指出該項缺口；外部 `/opsx:apply` 仍由其 owner 執行
- 完成後記錄實際 verify 結果；sync / archive 依適用流程與授權處理

### Generic Docs

- 一般文字、檔案、報告或既有 work-item 均可提供規劃 evidence；不強制 dhpk 專用文件集
- 檢查 evidence 是否說明範圍、預期結果、依據與缺口；只補上缺少的必要 outcome
- 交付前要能對照需求、變更與適用的測試 / 驗證 evidence

## Gate Matrix

| Required outcome | Feature | Bug Fix | Lightweight |
|-----------|---------|---------|-------------|
| 範圍、驗收與適用風險已足以開始 | Required; reuse existing evidence | Required; reuse existing evidence | Required for the requested edit |
| Root cause evidence | When repairing an established defect | Required before repair when cause is unknown | Skip unless investigation is needed |
| Design / dependency decision | Resolve only if it can change implementation | Resolve only if it can change the repair | Skip unless an actual decision is open |
| Behavior test evidence | Test-first for new or repaired behavior | Regression-first for repaired behavior | Only when behavior changes |
| Verification result | Applicable to acceptance | Applicable to acceptance | Targeted |

重點：

- `profile`、`legacy-reference` 或其他文件不存在，本身不構成 blocker；若它承載的必要事實尚未由 evidence 建立，指出該事實
- task/file count 不能單獨要求 planner、worker 或新文件
- `lightweight` 不應被 heavy gate 綁住
- 若輸入已說明足夠範圍、結果、依據與缺口，不要重複要求重跑前置流程
