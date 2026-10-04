# Workflow: Feature Delivery

只在 workflow type 已確定為 `Feature Delivery` 時讀取本檔。

## Use This Path When

- 新功能或新能力
- 行為改變
- 跨模組契約調整
- acceptance、設計或跨 owner handoff 仍需明確 outcome

## Outcome Checklist

1. **Requirements**：定義成功條件、in-scope、out-of-scope、風險與可觀測
   acceptance criteria。先檢查既有文字、檔案與報告；足以說明範圍、結果、
   依據與缺口時直接沿用，不要求 dhpk 專用格式。
2. **Design**：沿用已批准的設計與決策。只有跨模組邊界、依賴、相容性或
   render/runtime surface 仍未決定時，才取得 `architect` 或其他必要的結果。
3. **Artifacts**：建立 work-item、`profile`、`dev-scope`、`legacy-reference`
   或測試策略文件，只在專案明確要求、任務需要追蹤，或缺少必要結果時進行。
   不為了使用某個命名技能而重建已足夠的 proposal 或 plan。
4. **Implementation**：新行為先用獨立 RED evidence 驗證需求；依測試 seam、
   runtime setup、scope ownership 與 coupling 選擇 `tdd-workflow`、`tdd-guide`、
   worker 或 inline 路徑。
5. **Delivery loop**：依
   `references/delivery-loop-gate.md` 完成
   `/verify`、`change-verdict`、freshness、`change-verdict` 與
   `/precommit`。
6. **Handoff**：更新工作單與 handoff；apply-ready 時指向 `/opsx:apply`，
   不重跑已通過的前置階段。

## Blocking Rules

- 缺少專案或驗收明確要求的 input outcome：先指出具體缺口，不能以新文件名稱代替
- 缺 profile 或 legacy-reference 文件本身不構成 blocker；若其中有唯一必要事實未被其他證據建立，才要求該事實
- 有行為變更但缺少需求獨立的 RED evidence：不得宣稱新行為已由測試確認
- delivery-loop 的 test、adequacy、freshness 或 change-verdict 尚未 PASS：
  不得宣稱 ready
