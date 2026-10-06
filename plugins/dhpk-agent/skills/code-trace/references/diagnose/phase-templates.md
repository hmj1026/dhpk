# Phase Templates

Use these prompts in the response by default. Create an investigation artifact
only when explicitly authorized, following the main skill's read-only and
artifact-writing boundary.

## Investigation report

```markdown
# [問題摘要]

## 預期與觀察
- 預期行為與可檢查的症狀：
- 重現狀態：可重現 / 無法重現 / 受阻 / 間歇發生
- 執行的命令或操作：
- 相關輸出與症狀判定：
- 若為間歇問題，觀察到的成功次數、嘗試次數與已知條件：

## 證據與追蹤
- 已確認的入口與呼叫或資料路徑：
- 排序後的假設、支持與反證：
- 最小區辨檢查及結果：
- 效能問題才填：可比較的工作負載、環境與基準數據：
- 尚未取得的證據或安全／權限限制：

## 根因狀態
- 已確認 / 尚未確認：
- 根據與證據位置：

## 修正交接
- 可行方案、取捨與風險：
- 驗證意圖：
- 下一個負責工作流程或角色：
```

## Illustrative database query

The main skill owns the database access boundary. These are schematic,
read-only examples: use an authorized connection, bind values, select only
needed columns, and apply the row or time bounds required by the approved
environment. Do not use these examples to access a shared database without
authorization.

```sql
-- Adapt parameter and row-limit syntax to the approved database client.
SELECT [needed_columns]
FROM [table_name]
WHERE [key_column] = :key_value
LIMIT :approved_row_limit;
```

## Database evidence record

| Source and scope | Fields checked | Expected | Observed (redacted or summarized) | Time or version | Limitation |
| --- | --- | --- | --- | --- | --- |
| [authorized source] | [needed fields only] | [expected state] | [summary] | [when/version] | [gap] |

## Root-cause finding

```markdown
## 根因狀態
- 結論：已確認 / 未確認
- 最早有證據支持的分歧點：
- 觸發條件：
- 確認檢查及實際結果：
- 仍缺少的證據：
```

## Repair handoff

| Option | Evidence fit | Tradeoff or risk | Verification intent |
| --- | --- | --- | --- |
| [supported option] | [evidence] | [impact or uncertainty] | [observable result] |

Name the existing implementation workflow or owner for the next step. This
template stops at diagnosis and does not direct the reader to edit code or
apply a repair.
