# Workflow: Bug Investigation & Fix

只在 workflow type 已確定為 `Bug Investigation & Fix` 時讀取本檔。

## Use This Path When

- 錯誤、效能、安全、資料異常
- 根因未明或需要先建立證據鏈
- 需要 regression test 與最小修復策略

## Required Steps

1. 先重現並收集證據
2. 定義 root cause、影響範圍、non-goals
3. 確認 work-item readiness
4. 建立或確認 legacy-reference
5. 先寫 failing regression test，再修復
6. 做回歸、觀測、驗證與收尾

## Blocking Rules

- 缺 profile：不是單獨 blocker
- 缺 work-item：不可進入實作
- 缺 legacy-reference：不可進入實作
- 缺 RED / regression 證據：不可進入實作

若根因調查已在進行中，應優先 hand off 給 `bug-investigation`，不要在本技能內重複展開完整調查流程。
