# Workflow: Feature Delivery

只在 workflow type 已確定為 `Feature Delivery` 時讀取本檔。

## Use This Path When

- 新功能或新能力
- 行為改變
- 跨模組契約調整
- 需要完整前置治理與 handoff

## Required Steps

1. **Requirements**：定義成功條件、in-scope、out-of-scope、風險與可觀測
   acceptance criteria。
2. **Design**：確認邊界、依賴、相容性與 render/runtime surface；跨模組或
   DDD 決策先取得 `architect` 結論。
3. **Artifacts**：確認 work-item ready，建立或補齊 `profile`, `dev-scope`,
   `legacy-reference` 與測試策略。
4. **Implementation**：先以 `dhpk-tdd-workflow` / `tdd-guide` 建立 RED，
   再用 selector-resolved worker 或有界 inline path 完成 GREEN → REFACTOR。
5. **Delivery loop**：依
   `@skills/dhpk-execution-policy/references/delivery-loop-gate.md` 完成
   `/verify`、`dhpk-test-review`、freshness、`dhpk-change-review` 與
   `/precommit`。
6. **Handoff**：更新工作單與 handoff；apply-ready 時指向 `/opsx:apply`，
   不重跑已通過的前置階段。

## Blocking Rules

- 缺 profile：不可進入實作
- work-item 未 ready：不可進入實作
- 缺 legacy-reference：不可進入實作
- 缺 RED 證據：不可進入實作
- delivery-loop 的 test、adequacy、freshness 或 change-review 尚未 PASS：
  不得宣稱 ready
