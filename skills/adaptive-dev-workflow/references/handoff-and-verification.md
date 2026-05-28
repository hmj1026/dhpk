# Handoff And Verification

只在需要整理交付檢查、回報 gate 狀態或指向下一技能時讀取本檔。

## Completion Expectations

- `Feature Delivery`
  - profile / work-item / legacy / RED / verification 都要交代清楚
- `Bug Investigation & Fix`
  - evidence、root cause path、work-item、legacy、RED / regression 都要交代清楚
- `Lightweight Maintenance`
  - 明確列出 skip 項目與 targeted verification

## Recommended Handoff

- OpenSpec apply-ready：`/opsx:apply`
- bug root cause investigation in progress：`bug-investigation`
- implementation with failing tests ready：`test-driven-development`
- tiny localized cleanup after direct edit：`dhpk:code-reviewer`

## Verification Checklist

- [ ] workflow type 與理由一致
- [ ] gate status 清楚
- [ ] required / skipped artifacts 有區分
- [ ] next step 明確
