# Workflow: Feature Delivery

只在 workflow type 已確定為 `Feature Delivery` 時讀取本檔。

## Use This Path When

- 新功能或新能力
- 行為改變
- 跨模組契約調整
- 需要完整前置治理與 handoff

## Required Steps

1. 定義成功條件、in-scope、out-of-scope
2. 確認 work-item artifacts 已達可實作狀態
3. 建立或補齊 profile、dev-scope、legacy-reference
4. 先 RED，再 GREEN，再 REFACTOR
5. 執行測試與必要手動驗證
6. 完成後更新工作單與 handoff

## Blocking Rules

- 缺 profile：不可進入實作
- work-item 未 ready：不可進入實作
- 缺 legacy-reference：不可進入實作
- 缺 RED 證據：不可進入實作
