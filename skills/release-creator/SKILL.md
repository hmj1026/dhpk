---
name: release-creator
argument-hint: '<version>'
description: 'Cut a new release of the dhpk plugin, including version bumping, changelog editing, PR generation, merging, tagging, and CI tracking. Triggers: "release version", "create release", "bump version and release", "開始執行 release 流程", "發布新版本". Not for: releasing PHP packages/libraries (use composer-package-hygiene) or general git commits (use git-smart-commit).'
---

# Create Release — 發布新版本

切換至 `develop`、升級版本號、寫 CHANGELOG、發 PR 合併至 `main`、建立 tag 並推送，最後追蹤 CI Release 流程。

> 透過 `/create-release` 命令進入時，預設輸出逐步引導；帶 `--execute` 則直接非互動式執行整套流程。

## When NOT to Use

- 發布一般的 PHP 套件或函式庫 — 使用 `composer-package-hygiene`。
- 一般的功能或 Bug 提交 — 使用 `git-smart-commit`。
- 專案未合併至 `develop` 或測試未全數通過時。

## 流程

### 1. 檢查變更狀態

確保目前工作區乾淨，且處於最新的 `develop` 分支：

```bash
git status --short
git checkout develop
git pull
```

### 2. 升級版本號

修改以下 4 個檔案中的版本號（必須保持一致）：

1. `.claude-plugin/plugin.json` 中的 `"version"`
2. `.codex-plugin/plugin.json` 中的 `"version"`
3. `plugins/dhpk/.codex-plugin/plugin.json` 中的 `"version"`
4. `.agents/plugins/marketplace.json` 中的 `"version"`

### 3. 更新 Changelog

在 `CHANGELOG.md` 最上方插入新版本的更新說明：

```markdown
## <version> — YYYY-MM-DD — <摘要主題>

<簡短說明>

**feat(...)** — ...
**fix(...)** — ...
**docs(...)** — ...
```

> [!IMPORTANT]
> 標題格式必須是 `## <version> — YYYY-MM-DD — <摘要>`，其中 version 與後續的破折號之間需有空格，以利 CI 解析。

### 4. 本地驗證

提交前必須執行完整測試，確保版本號與結構無誤：

```bash
node tests/run-all.js
node scripts/ci/validate-plugin.js
node scripts/ci/catalog.js --check all
bash scripts/validate/validate-harness.sh
```

### 5. 提交並推送

暫存所有變更，並提交至 `develop` 分支後推送：

```bash
git add -A
git commit -m "chore(release): bump version to <version> and update changelog"
git push origin develop
```

### 6. 建立 Release PR 

建立 `develop` 合併至 `main` 的 Pull Request：

```bash
gh pr create --head develop --base main --title "Release v<version>" --body "Release version <version>"
```

### 7. 合併 PR

確認 PR 建立完成且通過檢查後，將其合併：

```bash
gh pr merge <PR_NUMBER> --merge --delete-branch=false
```

### 8. 建立並推送 Tag

切換到 `main` 分支、同步最新變更、標記版號 Tag 並推送：

```bash
git checkout main
git pull
git tag v<version>
git push origin v<version>
```

### 9. 追蹤 CI Release

使用 GitHub CLI 追蹤對應的 Action 流程以確保 Release 成功發布且自動 back-merge 回 `develop`：

```bash
gh run list --workflow release.yml --limit 1
gh run watch <RUN_ID>
```

最後切換回 `develop` 分支並同步：

```bash
git checkout develop
git pull
```

## Output

- 預設（逐步引導）：一份可逐步照做的 release 操作指引，涵蓋版本升級 → CHANGELOG → PR → tag → CI 追蹤。
- `--execute`：實際完成的 release — 已推送的 `v<version>` tag、CI Release Workflow 綠燈，並自動 back-merge 回 `develop`。

## Verification

- [ ] 版本號已在 4 個 JSON 檔案中同步更新。
- [ ] `CHANGELOG.md` 更新格式正確且已通過測試。
- [ ] PR 已建立並順利合併至 `main` 分支。
- [ ] `v<version>` tag 已成功推送，且 CI Workflow 順利執行完成。
- [ ] `develop` 已完成與 `main` 的自動 back-merge。
