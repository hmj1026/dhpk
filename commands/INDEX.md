---
description: 'Navigation index for dhpk plugin commands. Internal documentation; not an invocable command.'
---

# Commands Index (dhpk plugin)

> Navigation for slash commands shipped by the dhpk plugin. Commands are invoked as `/dhpk:<name>` (or `/dhpk:opsx:<name>` for OpenSpec).

## 開發流程（最常用）

| Command | 用途 | 對應階段 |
|---------|------|----------|
| `/create-dev` | 變更路由分類 → 驅動 `adaptive-dev-workflow` skill（分類 + planning agent + gate checklist），決定走 OpenSpec / brief plan | 接需求 |
| `/tech-spec` | 從需求產出技術規格文件 | 設計 |
| `/feature-dev` | 功能開發完整流程（設計→實作→驗證→review→commit） | 開發主流 |
| `/bug-fix` | Bug 修復工作流 | 開發 |
| `/feature-verify` | 只讀診斷：確認 feature 行為是否符合預期 | 驗證 |
| `/deep-analyze` | 深入分析提案並產出 roadmap | 研究 |
| `/feasibility-study` | 可行性評估（first principles） | 研究 |

> 根因分析用 skill `bug-investigation`（非 slash command）：直接描述問題觸發。
>
> **Codex 是 opt-in。** `/create-dev`、`/feature-dev`、`/bug-fix` 預設 codex-free（不呼叫 `mcp__codex__*`）；
> 傳 `--codex` 才委派給 `codex-*` command 走 Codex。`/dhpk:do` 會把實質 bug/feature 任務路由到
> `adaptive-dev-workflow`（codex-free 預設）。

## OpenSpec（artifact 工作流）

| Command | 用途 |
|---------|------|
| `/opsx:new` | 建立新 change 目錄與 proposal |
| `/opsx:continue` | 繼續未完成的 change |
| `/opsx:ff` | 一次產出所有 artifacts（proposal/specs/design/tasks） |
| `/opsx:apply` | 從 tasks.md 實作 |
| `/opsx:verify` | 驗證實作是否符合 artifacts |
| `/opsx:sync` | 同步 delta spec 到 main spec |
| `/opsx:validate-sync` | 預檢 sync 是否會 archive 失敗 |
| `/opsx:archive` | 封存已完成 change |
| `/opsx:bulk-archive` | 批次封存多個 change |
| `/opsx:explore` | 探索模式（需求釐清） |
| `/opsx:onboard` | OpenSpec 新手導覽 |

## 專案 Review（<your-project> 專屬）

| Command | 用途 |
|---------|------|
| `/review-pending` | 審查 `.pending-review` sentinel 中的檔案或指定路徑，完成後 code-reviewer 自動清除 sentinel |
| `/code-review` | Deprecated alias — forwards to `/review-pending` (removed in v1.0.0) |
| `/ts-check-status` | (JS module) 報告 `// @ts-check` / `// @ts-nocheck` / unmarked 分佈，衡量 progressive `@ts-check` 推進度 |

## Codex（第二意見 / 深度 review）

| Command | 用途 |
|---------|------|
| `/codex-architect` | 架構設計諮詢（Codex 第三腦） |
| `/codex-brainstorm` | 對抗式 brainstorm（Claude vs Codex） |
| `/codex-review` | 完整 second-opinion（含 lint + build） |
| `/codex-review-fast` | 快速 review（只看 diff） |
| `/codex-review-branch` | 整支 branch 自動化 review |
| `/codex-review-doc` | 文件 review |
| `/codex-cli-review` | Codex CLI 全專案 review |
| `/codex-explain` | 複雜邏輯解釋 |
| `/codex-implement` | Codex 寫程式 |
| `/codex-security` | OWASP Top 10 安全 review |
| `/codex-test-gen` | 產生單元測試 |
| `/codex-test-review` | 測試充足度 review |

## 檢查與驗證

| Command | 用途 |
|---------|------|
| `/precommit` | Pre-commit 檢查（lint:fix + build + test:unit） |
| `/precommit-fast` | 快速 pre-commit（lint:fix + test:unit） |
| `/verify` | 完整驗證迴圈（lint → typecheck → unit → integration → e2e） |
| `/post-dev-test` | 開發完成後測試涵蓋檢查 |
| `/check-coverage` | 三層測試涵蓋率評估 |
| `/check-skill` | Skill 品質驗證 |
| `/claude-health` | .claude/ 結構健康檢查 |
| `/dep-audit` | 依賴安全風險稽核 |
| `/project-audit` | 專案健康度多維度評分 |
| `/harness-audit` | Harness 自我檢視 |
| `/harness-govern` | Harness 治理迴圈：measure→conform(官方 best-practices)→fix→verify（編排既有 specialists，預設唯讀、可 /loop） |
| `/risk-assess` | 未提交變更風險評估 |
| `/review-spec` | 技術 spec 文件 review |
| `/pr-review` | PR 自我 review |
| `/ui-ux-verify` | UI/UX 驗證（比對 OpenSpec spec 與實際渲染） |

## Git 與提交

| Command | 用途 |
|---------|------|
| `/smart-commit` | 智慧分組提交 |
| `/create-pr` | 自動建立 PR（含 ticket 抽取） |
| `/pr-summary` | 列出 open PRs |
| `/merge-prep` | 合併前分析（衝突 / 影響） |
| `/git-worktree` | 管理 worktree（並行分支） |
| `/git-investigate` | 追蹤變更起源 |

## 文件與知識

| Command | 用途 |
|---------|------|
| `/update-docs` | 更新程式碼對應文件 |
| `/update-codemaps` | 產生/更新 CODEMAPS/ |
| `/doc-refactor` | 文件精簡 |
| `/de-ai-flavor` | 移除 AI 生成文件的樣板氣息 |
| `/project-brief` | 技術規格轉 PM/CTO 可讀摘要 |
| `/issue-analyze` | GitHub Issue 深度分析 |

## Skill / Plugin 管理

| Command | 用途 |
|---------|------|
| `/create-skill` | 建立 / 精進 skill |
| `/create-request` | 建立 / 更新需求文件 |
| `/install-rules` | 安裝 plugin rules 到專案 |
| `/install-scripts` | 安裝 plugin 腳本到專案 |
| `/install-hooks` | 安裝 plugin hooks 到專案 |

## 探索與分析

| Command | 用途 |
|---------|------|
| `/code-explore` | 純 Claude code 深度調查 |
| `/code-investigate` | Claude + Codex 雙視角調查 |
| `/simplify` | 收尾式重構簡化 |
| `/next-step` | 變更感知的下一步建議 |
| `/op-session` | 1Password CLI session 初始化 |
| `/repo-intake` | 專案首次上手盤點 |
| `/project-setup` | 一鍵 onboarding |
| `/zh-tw` | 將前一則回覆改寫為正體中文 |

## 呼叫約定

- `/<name>` — 全域 / 專案 scope 可直接呼叫
- `/opsx:<name>` — plugin namespace（OpenSpec）
- `/plugin:<name>` — 其他 plugin namespace

## 修改本檔時

- 新增 command → 同步更新 `../rules/execution-policy.md` 的 Skill trigger priority 區段。
- 刪除 command → 搜尋 MEMORY.md / execution-policy.md 確認無引用。
- 命令行為變更 → 檢查是否影響 `/create-dev` 路由結果。
