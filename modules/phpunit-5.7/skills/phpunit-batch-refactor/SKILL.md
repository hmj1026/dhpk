---
name: phpunit-batch-refactor
description: 'PHPUnit 5.7 批次重構工作流（已完成 Wave 1-5）：@test 移除、assertEquals→assertSame、方法命名標準化。適用場景：多個測試檔案同時進行批量改動。'
---

# PHPUnit Batch Refactor Workflow

**適用場景**：多個測試檔案同時進行 @test 移除、assertEquals → assertSame 轉換、方法命名標準化。

> **完成狀態**：Wave 1-5 已於 2026-03-02 全部完成（993 tests passed）。本 checklist 保留為未來新增測試檔案的參考規範。

## 前置掃描（必須）

在批量修改前執行，避免遺漏特殊情況：

```bash
# 1. 掃描所有待改檔案的方法命名規則
grep -r "public function should\|public function it_" protected/tests/unit/ protected/tests/integration/

# 2. 統計 @test / assertEquals 分布
grep -r "@test" protected/tests/ --include="*.php" | grep -v "test.com" | wc -l
grep -r "assertEquals" protected/tests/ --include="*.php" | wc -l

# 3. 識別 getMockBuilder with setMethods（無法安全轉換）
grep -B2 -A2 "setMethods()" protected/tests/ --include="*.php"
```

## 修改順序（重要）

1. **shouldXxx / it_xxx → testXxx** ← 必須優先轉換
2. **移除 @test 註解** ← 只有在方法名已是 testXxx 後才執行
3. **assertEquals → assertSame** ← 檢查型別，float 案例記錄例外

## 批次驗證策略

- **不按 batch 驗證**：改為按**檔案數量分組**（每 3-5 檔一驗）
- 原因：每個檔案的修改複雜度不同，小 batch 更易定位問題
- 流程：修改 → targeted PHPUnit → 通過後繼續

## 已知陷阱清單

| 陷阱 | 症狀 | 預防方案 |
|------|------|----------|
| shouldXxx 未轉換 | PHPUnit 無法識別測試（"No tests found in class"） | 前置掃描 + 優先轉換 |
| assertEquals 在註解 | 被誤轉為 assertSame，造成混淆 | grep + 手動審查 |
| float 型別不符 | assertSame 在 float 場景失敗（FP rounding） | 執行 targeted PHPUnit 確認，記錄 exception |
| getMockBuilder 遺漏 | 部分 mock 未替換，風格不一致 | 統計 getMockBuilder 但無 setMethods 的檔案 |

## 執行前必檢查

```bash
# 檢查待修改檔案清單
grep -c "function should\|function it_" <file>  # 應返回 0（已轉換）
grep -c "@test" <file>                           # 應返回 0（已移除）
```
