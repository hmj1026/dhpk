# Profile Foundations

只在下列情況讀取本檔：

- workflow type 已確定為 `Feature Delivery`
- `Bug Investigation & Fix` 需要補 profile 或確認環境規範
- 使用者明確要求建立/更新 `profile.yaml`

## Workflow Profile Fields

`profile.yaml` 至少應定義：

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
