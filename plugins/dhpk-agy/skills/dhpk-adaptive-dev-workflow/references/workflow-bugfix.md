# Workflow: Bug Investigation & Fix

只在 workflow type 已確定為 `Bug Investigation & Fix` 時讀取本檔。

## Use This Path When

- 錯誤、效能、安全、資料異常
- 根因未明或需要先建立證據鏈
- 需要 regression test 與最小修復策略

## Required Steps

1. **Evidence**：重現問題並收集錯誤輸出、輸入條件、影響範圍與目前樹狀
   狀態。
2. **Root cause**：根因未知時 hand off 給 `dhpk-root-cause-investigation`；
   已知時記錄檔案/行號、影響與 non-goals。
3. **Artifacts**：確認 work-item ready，建立或確認 `legacy-reference`；
   `profile` 可選但不取代 evidence。
4. **Regression-first fix**：先以 `dhpk-tdd-workflow` / `tdd-guide` 寫出
   failing regression test，再做最小修復。
5. **Delivery loop**：依
   `@skills/dhpk-execution-policy/references/delivery-loop-gate.md` 完成
   `/verify`、`dhpk-test-review`、freshness、`dhpk-change-review` 與
   `/precommit`。
6. **Handoff**：回報 root cause、fix、regression evidence 與唯一 next step。

## Blocking Rules

- 缺 profile：不是單獨 blocker
- 缺 work-item：不可進入實作
- 缺 legacy-reference：不可進入實作
- 缺 RED / regression 證據：不可進入實作
- delivery-loop 的 test、adequacy、freshness 或 change-review 尚未 PASS：
  不得宣稱 ready

若根因調查已在進行中，應優先 hand off 給 `dhpk-root-cause-investigation`，不要在本技能內重複展開完整調查流程。
