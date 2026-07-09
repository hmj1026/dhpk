---
name: release-creator
argument-hint: '<version>'
description: 'Cut a new release of a software project or plugin — resolve the project''s release config (version files, validate command, branch model), bump the version, edit the changelog, open a release PR, tag, and track CI. Triggers: "release version", "create release", "bump version and release", "開始執行 release 流程", "發布新版本". Not for: releasing PHP packages/libraries (use composer-package-hygiene) or general git commits (use git-smart-commit).'
---

# Create Release — 發布新版本

升級版本號、寫 CHANGELOG、發 PR 合併至發布分支、建立 tag 並推送，最後追蹤 CI Release 流程。本技能不綁定特定專案：先解析目標專案的發布慣例（版本檔、驗證指令、分支模型），再依解析結果執行。

> 透過 `/create-release` 命令進入時，預設輸出逐步引導；帶 `--execute` 則直接非互動式執行整套流程。

## When NOT to Use

- 發布一般的 PHP 套件或函式庫 — 使用 `composer-package-hygiene`。
- 一般的功能或 Bug 提交 — 使用 `git-smart-commit`。
- 專案尚未整合至基礎分支，或測試未全數通過時。

## 0. 解析發布設定（Resolve release config）

先決定本次 release 的實際參數，再往下執行。依序：

1. **專案已有 `RELEASE.md`** — 直接遵循它作為該專案的 SSOT（例如 dhpk 自身的 4-manifest lockstep、CI 與 git-flow 皆記於 `RELEASE.md`）。
2. **否則自動偵測 ecosystem** — 探測 `package.json` / `composer.json` / `pyproject.toml` / `Cargo.toml` / `.claude-plugin/plugin.json`，並讀取 `references/release-presets.md` 取得該 ecosystem 的版本檔、驗證指令、tag 慣例與分支模型。
3. **與使用者確認**下列解析值後才執行：

| Token | 意義 | 常見預設 |
|-------|------|---------|
| `{VERSION_FILES}` | 需同步更新版本號的檔案（可多個，lockstep） | `package.json` |
| `{VALIDATE_CMD}` | 提交前的驗證／測試指令 | `npm test` |
| `{BASE_BRANCH}` | 開發整合分支 | `main`（git-flow 時為 `develop`） |
| `{RELEASE_BRANCH}` | 發布分支 | `main` |
| `{TAG_PREFIX}` | tag 前綴 | `v` |
| `{CHANGELOG}` | changelog 檔案 | `CHANGELOG.md` |
| `{RELEASE_WORKFLOW}` | tag 觸發的 release CI workflow 檔名（若有） | `release.yml` |

## 流程

### 1. 檢查變更狀態

確保工作區乾淨且處於最新的 `{BASE_BRANCH}`：

```bash
git status --short
git checkout {BASE_BRANCH}
git pull
```

### 2. 升級版本號

將 `{VERSION_FILES}` 中的版本號改為 `<version>`。若專案有多個 manifest（如外掛的 lockstep），**全部需保持一致**，否則 CI 的 drift 檢查會失敗。

### 3. 更新 Changelog

在 `{CHANGELOG}` 最上方插入新版本說明。建議格式：

```markdown
## <version> — YYYY-MM-DD — <摘要主題>

<簡短說明>

**feat(...)** — ...
**fix(...)** — ...
**docs(...)** — ...
```

> [!IMPORTANT]
> 若專案 CI 以標題行擷取 release notes（如 `awk`），標題格式必須符合 CI 的預期——例如 `## <version> — YYYY-MM-DD — <摘要>` 中 version 與破折號之間需有空格。以 `RELEASE.md` 或 CI 設定為準。

### 4. 本地驗證

提交前執行專案的驗證指令，確保版本號與結構無誤：

```bash
{VALIDATE_CMD}
```

### 5. 提交並推送

```bash
git add -A
git commit -m "chore(release): bump version to <version> and update changelog"
git push origin {BASE_BRANCH}
```

### 6. 建立 Release PR

建立 `{BASE_BRANCH}` 合併至 `{RELEASE_BRANCH}` 的 Pull Request：

```bash
gh pr create --head {BASE_BRANCH} --base {RELEASE_BRANCH} --title "Release {TAG_PREFIX}<version>" --body "Release version <version>"
```

### 7. 合併 PR

依專案規則合併該 PR。**許多設定（含 dhpk）要求由真人點擊合併**——agent 自行推送的 PR 可能被 auto-mode classifier 阻擋。除非確認允許 agent 合併，否則準備好 PR 後交由真人合併。

### 8. 建立並推送 Tag

切換到 `{RELEASE_BRANCH}`、同步、標記版號 Tag 並推送：

```bash
git checkout {RELEASE_BRANCH}
git pull
git tag {TAG_PREFIX}<version>
git push origin {TAG_PREFIX}<version>
```

### 9. 追蹤 CI Release

若專案有 release CI（tag 觸發），追蹤其執行以確認 Release 發布成功（並在 git-flow 專案完成自動 back-merge 回 `{BASE_BRANCH}`）：

```bash
gh run list --workflow {RELEASE_WORKFLOW} --limit 1
gh run watch <RUN_ID>
```

最後切回 `{BASE_BRANCH}` 並同步：

```bash
git checkout {BASE_BRANCH}
git pull
```

## Output

- 預設（逐步引導）：一份可逐步照做的 release 操作指引，涵蓋設定解析 → 版本升級 → CHANGELOG → PR → tag → CI 追蹤。
- `--execute`：實際完成的 release — 已推送的 `{TAG_PREFIX}<version>` tag、CI Release Workflow 綠燈，並（git-flow 時）自動 back-merge 回 `{BASE_BRANCH}`。

## Verification

- [ ] 發布設定已解析並經使用者確認（version files、驗證指令、分支模型）。
- [ ] 版本號已在所有 `{VERSION_FILES}` 中同步更新。
- [ ] `{CHANGELOG}` 更新格式符合專案 CI 預期。
- [ ] PR 已建立並依專案規則合併至 `{RELEASE_BRANCH}`。
- [ ] `{TAG_PREFIX}<version>` tag 已成功推送，且 CI Workflow（若有）順利完成。
- [ ] git-flow 專案已完成與 `{RELEASE_BRANCH}` 的 back-merge。
