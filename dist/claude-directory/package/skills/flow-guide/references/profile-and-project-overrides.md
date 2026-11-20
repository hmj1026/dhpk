# Profile Foundations

只在下列情況讀取本檔：

- `Feature Delivery` 需要補足或確認 stack、runtime 或專案規範
- `Bug Investigation & Fix` 需要補足尚未建立的環境規範
- 使用者明確要求建立/更新 `profile.yaml`

## Workflow Profile Fields

若任務需要明確記錄 workflow profile，`profile.yaml` 至少應定義：

1. `language`
2. `runtime`
3. `current_version`
4. `target_upgrade_version`
5. `architecture_style`
6. `test_strategy`
7. `style_rules`
8. `dependency_policy`
9. `work_item_system`

原則：規範應由 profile 與專案權威文件驅動，不要把語言/版本/框架細節硬編碼回主 `SKILL.md`。

若需要 repo-specific 預填值或 shortcut，改讀 `projects-index.md`，再依使用端專案的 `@rules/dev-workflow-project.md`（若有）補載專案 pack。
