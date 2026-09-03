---
description: 'Navigation index for dhpk plugin commands. Internal documentation; not an invocable command.'
---

# Commands Index (dhpk plugin)

> Navigation for slash commands shipped by the dhpk plugin. dhpk commands are
> invoked as `/dhpk:<name>`. External OpenSpec commands, when that separate
> plugin is installed, use `/opsx:<name>`.

## 工作入口與交付

| Command | 用途 |
|---------|------|
| `/dhpk:deep-analyze` | 深入分析提案並產出 roadmap。 |
| `/dhpk:spec-mine` | 從既有程式碼萃取 behavioral specification。 |
| `/dhpk:opsx-apply-resume` | 長時間 `opsx:apply` 的 context handoff。 |

## Review、測試與驗證

| Command | 用途 |
|---------|------|
| `/dhpk:codex-test-gen` | Explicit-only test generation adapter；review 已整併至 `change-verdict` 的 `tests` mode。 |
| `/dhpk:check-coverage` | Explicit-only legacy alias for test coverage；不屬於 frozen eight-command family，也不計入其數字。 |
| `/dhpk:precommit` / `/dhpk:precommit-fast` / `/dhpk:verify` | 提交前或完整驗證。 |
| `/dhpk:dep-audit` | 依賴安全風險稽核。 |
| `/dhpk:review-pending` | 完成 pending-review sentinel 對應的 review。 |

## Git、發布與工作區

| Command | 用途 |
|---------|------|
| `/dhpk:smart-commit` / `/dhpk:create-pr` | 分組提交與建立 PR。 |
| `/dhpk:create-release` | 版本、changelog、PR、tag 與 CI 的 release 流程。 |
| `/dhpk:git-worktree` | 管理平行 worktree。 |
| `/dhpk:merge-prep` / `/dhpk:pr-summary` | 合併前分析與 open PR 摘要。 |

## Harness、文件與設定

| Command | 用途 |
|---------|------|
| `/dhpk:harness-audit` / `/dhpk:harness-govern` | Harness 的單次評估與 measure→conform→fix→verify 迴圈。 |
| `/dhpk:update-docs` / `/dhpk:update-codemaps` / `/dhpk:doc-refactor` | 更新、產生或精簡文件；`update-docs` 以實作證據與 writing-for-agents 契約為準。 |
| `/dhpk:project-brief` | 將技術內容整理為 PM/CTO 摘要。 |
| `/dhpk:setup` | 設定 plugin；用 `--install hooks\|rules\|scripts\|all` 安裝資產。 |
| `/dhpk:install-hooks` / `/dhpk:install-rules` / `/dhpk:install-scripts` | 已棄用的一個 minor-release forwarding alias；新文件與新流程不得使用。 |

## 專用工具

| Command | 用途 |
|---------|------|
| `/dhpk:matrix-cell-onboard` | 為多 major library CI matrix 新增 cell。 |
| `/dhpk:ui-ux-verify` | 比對 OpenSpec spec 與實際 UI 渲染。 |
| `/dhpk:simplify` | 收尾式重構簡化。 |

## 呼叫約定

The former review aliases are retired without forwarding aliases. Use the
read-only `change-verdict` skill with its `code`, `pr`, `security`, `tests`,
`docs`, or `risk` mode. `codex-test-gen` remains an explicit-only,
Codex-MCP-free generation adapter using the TDD workflow. The default Claude
discovery artifact is the materialized `minimal` profile; `full` and `compat-v1`
are explicit opt-in artifacts. `check-coverage` remains an explicit-only
compatibility alias outside that count.

- `/dhpk:<name>` — 本 plugin 實際註冊的 command namespace。
- `dhpk-<skill-name>` — 一般 public skill identity，不是 `commands/` alias。六個
  portable capability-family 例外使用無前綴名稱：`skill-scope`、`skill-forge`、
  `flow-guide`、`flow-drive`、`change-verdict`、`code-trace`。

## 修改本檔時

- 新增或移除 command → 與 `commands/` 目錄及 `commands/INDEX.md` 同步，避免在索引宣稱未註冊的 command。
- 命令行為變更 → 檢查是否影響 `flow-drive` route/implement mode 或相關 skill handoff。
