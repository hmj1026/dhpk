# Work-Item And Gates

只在下列情況讀取本檔：

- workflow type 是 `Feature Delivery` 或 `Bug Investigation & Fix`
- 需要判斷 work-item 是否 ready
- 需要說明為何 gate PASS / FAIL

## Work-Item Systems

### OpenSpec

- 用 `status` 與 `instructions/apply` 判斷 artifact readiness
- apply-ready 前不得進入正式實作
- 完成後至少要有 verify；必要時 sync / archive

### Generic Docs

- 維持最小文件集：`proposal`、`tasks`、`implementation-notes`
- `tasks` 未 ready 前不得進入正式實作
- 交付前要能對照需求、變更與測試證據

## Gate Matrix

| Gate 項目 | Feature | Bug Fix | Lightweight |
|-----------|---------|---------|-------------|
| profile 已確認 | Required | Optional | Skip |
| work-item 就緒 | Required | Required | Skip |
| legacy-reference.md | Required | Required | Skip |
| RED -> GREEN 證據 | Required | Required | Skip |
| 驗證紀錄 | Required | Required | Targeted |

重點：

- `bugfix` 缺 profile 不會單獨擋住流程
- `lightweight` 不應被 heavy gate 綁住
- 若 prompt 明確說條件已齊全，不要重複要求重跑前置流程
