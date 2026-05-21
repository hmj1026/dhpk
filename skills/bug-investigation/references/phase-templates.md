# Phase Templates

## Table of Contents
- Investigation document template
- SQL verification templates
- Database evidence table template
- Root cause template
- Solution proposal template
- Knowledge base templates

## Investigation document template

建立 `docs/knowledge/[feature-name]/investigation.md`：

```bash
mkdir -p docs/knowledge/[feature-name]
```

```markdown
# [問題標題] 調查紀錄

## 問題描述
- **預期行為**：
- **實際行為**：
- **樣本資料**：

## 調查進度
- [ ] Phase 1: 問題釐清
- [ ] Phase 2: 證據蒐集
- [ ] Phase 3: 根因分析
- [ ] Phase 4: 修正方案設計
- [ ] Phase 5: 知識文件化

## 阻礙與缺口
- [ ] [描述阻礙、缺口與下一步]
```

## SQL verification templates

```sql
-- 範本：查詢主要交易
SELECT * FROM [main_table] WHERE [id] = '[sample_id]';

-- 範本：查詢關聯紀錄
SELECT * FROM [related_table] WHERE [foreign_key] = '[sample_id]';

-- 範本：查詢日誌
SELECT * FROM [log_table] WHERE [reference] = '[sample_id]';
```

## Database evidence table template

```markdown
## 資料庫證據

| 資料表 | 欄位 | 預期 | 實際 | 備註 |
|--------|------|------|------|------|
| [table] | [field] | [expected] | [actual] | [note] |
```

## Root cause template

```markdown
## 根因分析

### 資料流
[流程圖或逐步說明]

### 問題位置
- **檔案**： [檔案路徑]
- **行號**： [行號]
- **問題**： [問題描述]

### 發生原因
[觸發問題的條件與原因說明]
```

## Solution proposal template

```markdown
# [問題標題] 修正方案

## 方案選項
| 方案 | 描述 | 優點 | 風險/缺點 | 影響範圍 | 測試需求 |
|------|------|------|-----------|----------|----------|
| A | [前端修正] | [...] | [...] | [...] | [...] |
| B | [後端修正] | [...] | [...] | [...] | [...] |
| C | [前後端整合] | [...] | [...] | [...] | [...] |

## 判斷依據
- [引用 Phase 2/3 的證據與限制]
- [風險、成本、效益、時間與可回滾性]

## 推薦方案
- [建議方案與理由]

## 後續行動
- [實作步驟 / 測試 / 佈署與回滾]
```

## Knowledge base templates

`data-flow.md`
```markdown
# [功能名稱] - 資料流

## 概述
[功能簡述]

## 資料流圖
使用者動作 → [前端函式] → [後端 API] → [資料表]

## 關鍵變數
| 變數 | 位置 | 用途 |
|------|------|------|
| `[var]` | [file:line] | [用途說明] |
```

`key-functions.md`
```markdown
# [功能名稱] - 關鍵函數

## 前端 (JavaScript)
| 函數 | 檔案 | 說明 |
|------|------|------|
| `[func]()` | [file:line] | [功能說明] |

## 後端 (PHP)
| 函數 | 檔案 | 說明 |
|------|------|------|
| `[func]()` | [file:line] | [功能說明] |
```

`related-tables.md`
```markdown
# [功能名稱] - 資料表

## 主要資料表
| 資料表 | 主鍵欄位 | 用途 |
|--------|----------|------|
| `[table]` | `[pk]` | [用途說明] |

## 紀錄表
| 資料表 | 主鍵欄位 | 用途 |
|--------|----------|------|
| `[table]` | `[pk]` | [用途說明] |
```
