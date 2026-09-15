# Workflow: Lightweight Maintenance

只在 workflow type 已確定為 `Lightweight Maintenance` 時讀取本檔。

## Use This Path When

- 不改行為的小修
- 純整理、rename、常數抽取、註解或文案修正
- 局部重構且可用 targeted verification 證明安全

## Skip List

以下項目應明確標示為 skip，不要展開 heavy flow：

- `profile.yaml`
- `dev-scope.md`
- `legacy-reference.md`
- heavy gate check
- RED -> GREEN 證據

## Required Minimum

1. 變更最小化
2. 至少一個 targeted verification
3. 保持與專案既有 style 一致
4. 指出下一步，例如 `dhpk:code-reviewer`
