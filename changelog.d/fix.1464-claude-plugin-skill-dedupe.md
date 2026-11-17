scope: projection
note: 官方 Claude plugin dhpk@dhpk 對專案已啟用且其 package catalog 已提供某個 skill 時，專案不再發佈重複的 `.claude/skills/<name>` binding；停用或未安裝時維持或還原 binding，狀態無法判定時不刪除並阻擋新增 binding，可用 `--claude-plugin-state inactive` 略過檢查 (#1464)。
