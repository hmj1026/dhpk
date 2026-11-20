# Collector contract

解讀 `collect-changes.js` 的摘要或診斷失敗時閱讀本頁。提交授權與分群流程由 [SKILL.md](../SKILL.md) 定義。

## 輸出欄位

成功時 stdout 是一份 `schemaVersion: 1` JSON：

- `repoRoot`、`head`（尚無 commit 時為 `null`）、`branch`（detached HEAD 時為 `null`）、`scope`。
- `files`：每個路徑的 `path`、`originalPath`（rename 來源）、`indexStatus`、`worktreeStatus`，以及 `staged`、`unstaged` 的增刪摘要。行數為 `null` 表示未知；整個摘要欄位為 `null` 表示未取得該層 numstat，需搭配 status 判斷，不能單憑它排除變更。
- `safety`：`hasStaged`、`hasPartialStaging`、`hasOutOfScopeStaged`、`hasConflicts`、`operations`。這些狀態涵蓋整個 repository，不受 scope 篩選限制。
- `hooks`：有效 hooks 目錄，以及 `preCommit`、`commitMsg` 的 `exists` 和 `executable` 狀態；不代表已執行或通過。

`--scope` 接受 repo-relative literal path，rename 的新舊路徑任一符合即納入。收集器不輸出 diff 或檔案內容，也不執行 hooks。

## 失敗與環境限制

失敗時退出非零，stderr 說明原因，stdout 不輸出成功 JSON。保留原始環境並停止提交流程；修正原因後重新收集。

- `UNSUPPORTED_GIT_ENV`：`GIT_DIR`、`GIT_WORK_TREE`、`GIT_COMMON_DIR`、`GIT_INDEX_FILE`、`GIT_OBJECT_DIRECTORY`、`GIT_ALTERNATE_OBJECT_DIRECTORIES` 或 `GIT_PREFIX` 非空；在呼叫 Git 前拒絕 repository／index 重導向。
- `UNSUPPORTED_FILTER_CONFIG`：有效 Git config 設有非空 `filter.*.clean` 或 `filter.*.process`；在 status／diff 前停止，保留 filters 設定供人工檢查。
- `UNSUPPORTED_SUBMODULE`：index 含有 submodule（gitlink），包含尚未初始化或處於衝突階段的項目；在 status／diff 前停止，避免遞迴查詢執行 submodule 自己的 filters。這類 repository 需人工檢查。
- `GIT_QUERY_FAILED`：Git 查詢失敗、逾時或超過 16 MiB buffer。輸出 JSON 也受 16 MiB 上限限制。
- `SOURCE_DRIFT`：前後觀察到的 HEAD、porcelain status 或 staged／unstaged numstat 不一致。待來源穩定後重新收集及檢查受影響差異。
- 無效 scope、非 UTF-8 路徑、截斷或無法解析的 Git 輸出、無法讀取 metadata 也會停止；不將錯誤當成空清單。

## 一致性邊界

收集器只做有限次唯讀查詢，結束前重查 HEAD、status 與 numstat，沒有鎖住其他 Git 程序或編輯器。相同行數的內容替換、變動後又恢復、最後檢查後的修改，都可能無法辨識；hooks／操作中狀態也不是原子快照的一部分。成功只表示這些前後觀察一致，不是內容未變或可直接提交的證明。

因此摘要只用來定位待檢查的功能群；完整內容審查與每次 commit 前的 index 核對仍由 skill 流程負責。
