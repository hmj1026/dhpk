# Handoff And Verification

只在需要整理交付檢查、回報 gate 狀態或指向下一技能時讀取本檔。

## Completion Expectations

- `Feature Delivery`
  - 回報已採用的計畫與 evidence、任務或專案明確要求的 profile / work-item / legacy / RED outcomes、verification 與剩餘缺口；不要重建已充分的 artifacts
- `Bug Investigation & Fix`
  - 回報適用的症狀與 root-cause evidence、任務或專案明確要求的 work-item / legacy / regression outcomes、verification 與剩餘缺口
- `Lightweight Maintenance`
  - 明確列出 skip 項目與 targeted verification

## Recommended Handoff

- OpenSpec apply-ready：`/opsx:apply`
- bug root cause investigation in progress：`code-trace`
- implementation with failing tests ready：`tdd-guide` agent
- tiny localized cleanup after direct edit：`dhpk:code-reviewer`

## Verification Checklist

- [ ] workflow type 與理由一致
- [ ] gate status 清楚
- [ ] required / skipped artifacts 有區分
- [ ] next step 明確

在 dhpk 專案中，light／selected／full 分類與交付語意依專案的 testing-governance policy；其他專案依其 Project Convention。若適用 CI plan，closeout 回報 plan 的 base/head/checkout identity、classification 狀態與理由、required/skipped checks、實際結果及未解缺口；plan 宣告本身不代表檢查已通過。
