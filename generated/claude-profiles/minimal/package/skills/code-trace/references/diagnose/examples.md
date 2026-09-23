# Bug Investigation Examples

此文件說明 `examples/` 內的案例與建議使用方式。

## 範例清單

- `examples/state-inconsistency-example/`
  - 場景：系統狀態不一致
  - 重點：資料流追蹤、矛盾點定位、Mermaid 圖表輔助

## 使用方式

1. 閱讀範例，理解 5 階段調查流程
2. 套用結構到當前問題
3. 以通用術語撰寫，移除任何敏感資料

## 建議結構模板

```markdown
# [您的問題] 調查

## 問題描述
- **預期**：
- **實際**：
- **樣本**：

## 調查過程
### Phase 1: Problem Discovery
### Phase 2: Evidence Gathering
### Phase 3: Root Cause Analysis
### Phase 4: Solution Proposal
### Phase 5: Knowledge Documentation
```

## 注意事項

- 盡量提供可重現步驟與樣本 ID
- 記錄資料庫與程式碼的對照位置
