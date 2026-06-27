---
description: 'Navigation index for dhpk plugin commands. Internal documentation; not an invocable command.'
---

# Commands Index (dhpk plugin)

> Navigation for slash commands shipped by the dhpk plugin. Commands are invoked as `/dhpk:<name>` (or `/dhpk:opsx:<name>` for OpenSpec).

## 開發流程（最常用）

| Command | 用途 | 對應階段 |
|---------|------|----------|
| `/do` | Smart Router — 把自然語言任務對應到正確的 dhpk workflow（route-table 快路徑 + LLM fallback） | 入口 |
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
| `/opsx-apply-resume` | dhpk wrapper：長時 `opsx:apply` 的 context handoff（/fork 或 /new 前存檔，之後無縫續跑） |
| `/opsx-goal` | Given a change-id, reads tasks/scope and emits a tailored `/goal` condition + `/opsx:apply` sequence ready to paste into a fresh implementation session |

## 專案 Review（<your-project> 專屬）

| Command | 用途 |
|---------|------|
| `/review-pending` | 審查 `.pending-review` sentinel 中的檔案或指定路徑，完成後 code-reviewer 自動清除 sentinel |
| `/ts-check-status` | (JS module) 報告 `// @ts-check` / `// @ts-nocheck` / unmarked 分佈，衡量 progressive `@ts-check` 推進度 |
| `/yii1-security-audit` | (Yii 1.1 module) Yii 1.1 專屬安全稽核 |

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

> **Review 變體怎麼選**（範圍 / 機制不同，非重複）：
> `/codex-review-fast`（只看 diff，無 tests，最快，日常小改）→ `/codex-review`（diff + lint:fix + build，提交前完整 second opinion）→ `/codex-review-branch`（整支 branch 自動化，PR 前）。
> `/codex-cli-review` 走 Codex **CLI**（非 MCP），Codex 自主探索全專案——跨檔深掘時用。
> **Codex vs codex-free 對偶**：`/codex-security`（Codex 驅動）對應 skill `security-review`（codex-free）。
> **Wrapper 命名注意**：`/codex-test-review` = skill `test-review`、`/codex-review-doc` = skill `doc-review`（command 加 `codex-` 前綴，skill 沒有；是 wrapper 對應，非兩份重複內容）。

## 檢查與驗證

> **Harness 家族（單一前門：`/harness-govern`）** — 建置/onboard → `/harness-fill`；單次評分 → `/harness-audit`（deterministic 7 類 score）或 `/harness-budget`（token 計帳 skill）；單次修剪 → `/harness-revise`（G1-G13）；完整 measure→conform→fix→verify 迴圈（預設、可 /loop）→ `/harness-govern`。廣義 reliability/cost/throughput 評分已併入 `/harness-govern` 的 conform 步驟（原 `harness-optimizer` agent 已移除）。

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
| `/harness-audit` | Harness 自我檢視（deterministic 7 類 score） |
| `/harness-govern` | **Harness 家族單一前門**：measure→conform(官方 best-practices + 五大槓桿掃描)→fix→verify（編排既有 specialists，預設唯讀、可 /loop） |
| `/harness-revise` | Harness trim / dedupe / validate（G1-G13 gap taxonomy） |
| `/matrix-cell-onboard` | 為多 major library CI matrix 新增 PHP/Laravel/PHPUnit/Monolog cell |
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
| `/deploy-list` | 產生跨專案部署檔案清單（schema=v1，preset 分類 + anchor-grep） |

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
| `/dhpk-setup` | 互動式（重新）設定 dhpk plugin 選項（modules / docker / review agents / hook profile） |

## Instinct / 學習系統

| Command | 用途 |
|---------|------|
| `/instinct-status` | 顯示已學習 instincts（project + global）與信心值 |
| `/instinct-export` | 匯出 instincts 到檔案 |
| `/instinct-import` | 從檔案 / URL 匯入 instincts |
| `/promote` | 將 project-scoped instinct 升級為 global |
| `/evolve` | 分析 instincts 並建議 / 產生演化後結構 |

## 探索與分析

| Command | 用途 |
|---------|------|
| `/code-explore` | 純 Claude code 深度調查 |
| `/code-investigate` | Claude + Codex 雙視角調查 |
| `/simplify` | 收尾式重構簡化 |
| `/next-step` | 變更感知的下一步建議 |
| `/op-session` | 1Password CLI session 初始化 |
| `/repo-intake` | 專案首次上手盤點 |
| `/harness-fill` | Explore 驅動，平行盤點專案 → 填入缺少的 .claude/ skills/agents/rules + 各層 CLAUDE.md（meta-workflow，一次性；harness 家族的 onboard 入口，詳見「檢查與驗證」段的家族決策樹） |
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
