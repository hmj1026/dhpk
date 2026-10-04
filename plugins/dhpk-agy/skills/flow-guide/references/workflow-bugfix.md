# Workflow: Bug Investigation & Fix

只在 workflow type 已確定為 `Bug Investigation & Fix` 時讀取本檔。

## Use This Path When

- 錯誤、效能、安全、資料異常
- 根因未明或需要先建立證據鏈
- 需要 regression test 與最小修復策略

## Outcome Checklist

1. **Evidence**：沿用仍適用的輸出、輸入條件、影響範圍與目前狀態證據。已
   充分說明症狀與範圍的報告可直接採用；只追查可能改變修復路徑的缺口。
2. **Root cause**：根因未明時，先用 `code-trace` 建立根因結果；已有充分診斷
   時不重跑調查。記錄必要的檔案/行號、影響與 non-goals。
3. **Artifacts**：確認現有 issue、OpenSpec 或其他追蹤項目是否提供所需範圍與
   驗收結果。只有專案要求或必要結果缺失時才建立新文件；`profile` 可選且不能
   取代故障證據。
4. **Regression-first fix**：行為修正先建立需求獨立的 failing regression test；
   依測試 seam 與 runtime setup 選用 `tdd-workflow` 或 `tdd-guide`。
5. **Delivery loop**：依
   `references/delivery-loop-gate.md` 完成適用的 verification、test adequacy、
   freshness、single review wave 與 `/precommit`；充分的外部 evidence 可提供
   相同 outcome，不重複指定 producer 或 receipt。
6. **Handoff**：回報 root cause、fix、regression evidence 與唯一 next step。

## Blocking Rules

- 缺 profile：不是單獨 blocker
- 根因未明且將影響修復選擇：不可直接交 writer；只要求缺少的根因證據
- work-item 或 `legacy-reference` 文件缺少本身不構成 blocker；若所需狀態或歷史事實沒有其他證據，指出該結果缺口
- 行為修正缺少能重現問題的 regression evidence：不得宣稱修復已驗證
- delivery-loop 的 test、adequacy、freshness 或適用的 review outcome 尚未 PASS：
  不得宣稱 ready

若根因調查已在進行中，沿用其最新且適用的 evidence；只有未解問題仍會改變修復路徑時才 hand off 給 `code-trace`，不要重複展開已完成的調查流程。
