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
| `/dhpk:flow-guide` / `/dhpk:flow-drive` | 唯讀 usage discovery、路由與已確認工作的 explicit-only 實作 front door。 |
| `/dhpk:deep-analyze` | 深入分析提案並產出 roadmap。 |
| `/dhpk:opsx-apply-resume` | 長時間 `opsx:apply` 的 context handoff。 |

## Review、測試與驗證

| Command | 用途 |
|---------|------|
| `/dhpk:tdd-workflow test-generation` | 使用保留的 TDD skill 產生測試；review 使用 `change-verdict` 的 `tests` mode。 |
| `/dhpk:change-verdict --mode tests --coverage` | 使用保留的唯讀 review skill 檢查 coverage。 |
| `/dhpk:precommit` / `/dhpk:verify` | 提交前或完整驗證。 |
| `/dhpk:dep-audit` | 依賴安全風險稽核。 |
| `/dhpk:review-pending` | 針對指定路徑或目前 diff 派遣 code-reviewer 進行建議性審查。 |

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
| `/dhpk:update-docs` / `/dhpk:update-codemaps` / `/dhpk:doc-refactor` | 更新、產生或精簡文件；`update-docs` 以實作證據與 writing-for-agents 契約為準。 |
| `/dhpk:project-brief` | 將技術內容整理為 PM/CTO 摘要。 |
| `/dhpk:setup` | 設定 plugin；用 `--install hooks\|rules\|scripts\|all` 安裝資產。 |

## 專用工具

| Command | 用途 |
|---------|------|
| `/dhpk:matrix-cell-onboard` | 為多 major library CI matrix 新增 cell。 |
| `/dhpk:ui-ux-verify` | 比對 OpenSpec spec 與實際 UI 渲染。 |
| `/dhpk:simplify` | 收尾式重構簡化。 |

## 呼叫約定

The former review aliases are retired without forwarding aliases. Use the
read-only `change-verdict` skill with its `code`, `pr`, `security`, `tests`,
`docs`, or `risk` mode. Test generation uses the retained
`tdd-workflow test-generation` capability. The default Claude
discovery artifact is the `common` collection from `manifests/install-profiles.json`;
public profiles are retired. Use `flow-guide help <skill>` for
output and stop-condition metadata. Coverage review uses
`change-verdict --mode tests --coverage`.

For Codex usage discovery, run `$flow-guide help` or `$flow-guide help <skill>`;
use `$flow-guide <help|route|rules|next|close>` for guidance and
`$flow-drive <confirmed-spec-or-change-id>` for explicit, mode-free
implementation. Proposal authoring belongs to external `$openspec-propose`;
OnePassword authentication is the operator action `op signin`.

`git-smart-commit` keeps its existing public name and stable ID. `agy-commit` is
retired without an alias. Dedicated harness governance and its predecessor
commands are retired; their former modes are no longer callable.

- `/dhpk:<name>` — 本 plugin 實際註冊的 command namespace。
- `dhpk-<skill-name>` — 一般 public skill identity，不是 `commands/` alias。
  portable capability-family 例外使用無前綴名稱：  `flow-guide`、`flow-drive`、`change-verdict`、`code-trace`、`laravel`、
  `phpunit`。

## 修改本檔時

- 新增或移除 command → 與 `commands/` 目錄及 `commands/INDEX.md` 同步，避免在索引宣稱未註冊的 command。
- 命令行為變更 → 檢查是否影響 `flow-guide` action、`flow-drive` confirmed
  implementation handoff，或相關 skill handoff。
