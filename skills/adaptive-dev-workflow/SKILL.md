---
name: adaptive-dev-workflow
description: 'Workflow router for substantial changes. Use when: a feature, bugfix, refactor, security, perf, or OpenSpec change needs classifying into Feature Delivery, Bug Investigation, or Lightweight Maintenance before heavy context loads. Not for tiny edits, investigation already underway, code review, or apply-ready OpenSpec tasks. Output: workflow classification + required artifacts + gate checklist.'
argument-hint: '[--codex] <change description or current state>'
allowed-tools: 'Read, Grep, Glob, Bash, Skill, Agent'
---

# Adaptive Dev Workflow

## Overview

本技能負責先做 workflow 分流，再決定是否需要 profile、scope、work-item、gate 這些前置資產。主 `SKILL.md` 只保留決策核心；重內容與專案特化資訊必須在符合條件時才漸進式載入。

## When NOT to Use

- CLAUDE.md Execution Policy 定義的 small change：直接 patch + dhpk:code-reviewer
- 已在進行 root-cause 調查：改用 `bug-investigation`
- 純架構設計或 module boundary 討論：改用 `software-architecture`
- OpenSpec change 已 apply-ready：直接切去 `/opsx:apply`
- 已進入 TDD 實作階段：改用 `tdd-guide` agent

## Core Principles

1. 先決定 workflow type，再決定要不要載入 heavy context。
2. 規範優先由專案權威文件驅動，例如 `CLAUDE.md`；技能只補 workflow 缺口。
3. `Lightweight Maintenance` 只做最小驗證，不建立 profile/scope/gate 重資產。
4. `Feature Delivery` / `Bug Investigation & Fix` 才能展開 profile、work-item、legacy、RED gate。

## Fast-worker invocation context

When `/dhpk:do` supplies `FAST_WORKER_OVERRIDE`, preserve that exact invocation-only
value through hand-off to `dhpk:bug-fix` / `dhpk:feature-dev`. Before the first
mechanical dispatch, consume it with the shared selector at
`scripts/fast-worker-selector.js` using `--backend "$FAST_WORKER_OVERRIDE"`.
`unset` means omit the explicit backend argument and let the selector apply
userConfig/default precedence; never infer the value from the cleaned task text.

## Codex mode (opt-in)

本技能**預設 codex-free**——只用 Claude + dhpk agents，不需要 Codex CLI/MCP。傳入 `--codex` 才走
Codex 強化路徑（planning、實作、review 用 Codex 取得獨立第二意見）。若給了 `--codex` 但 Codex 不可用，
警告一次後 fall back 到 codex-free。

**隔離原則（重要）：** 預設模式下**不得**呼叫任何 `mcp__codex__*` 工具；本技能的 `allowed-tools` 也
刻意不含 `mcp__codex__*`。Codex 只透過委派給專屬 `codex-*` command 取得（它們各自擁有該權限）。

下列每個 phase 在兩種模式下的對應：

| Phase | Codex-free（預設） | `--codex` |
|------|--------------------|-----------|
| Planning（跨模組 / DDD） | `dhpk:architect` agent | `/codex-architect` |
| Planning（根因未知） | `bug-investigation` skill | `/codex-brainstorm` 或 `code-investigate` |
| 實作 hand-off | `dhpk:bug-fix` / `dhpk:feature-dev` | 同上 `… --codex` |
| Test gate | `dhpk:tdd-guide` agent + `/check-coverage` | `/codex-test-review` |
| Review gate | `dhpk:code-reviewer`（`/review-pending`） | `/codex-review-fast` |
| Security gate | `dhpk:security-review`（inline OWASP） | `/codex-security` |

底下 Planning-Phase / Post-Implementation / Next Commands 各表列出的是 codex-free 預設路徑；當 `CODEX=on`
時，依本表替換對應步驟，並在 "Next Command" 輸出時把 `--codex` 一併帶到建議的下游命令。

## Workflow Decision

### Feature Delivery

適用於新能力、行為變更、跨模組契約調整、或需要完整前置治理的變更。

### Bug Investigation & Fix

適用於錯誤、效能、安全、資料異常等問題；先確認證據、根因與 regression path。`profile` 可選，但 work-item、legacy、RED gate 仍是 blocker。

### Lightweight Maintenance

適用於不改行為的小修、純整理、局部重構。跳過 heavy artifacts，只保留 targeted verification 與 next-step 建議。

### 與 SSOT 六種變更類型的對應

本節 3 個 workflow bucket 對應 `@rules/execution-policy.md` → *Change classification & OpenSpec routing (SSOT)* 表格的 6 列（該表是權威來源，本節只做對應說明，不重述其內容）：

- **Feature Delivery** ← SSOT 的「Feature Delivery (cross-module / DDD)」與「Feature Delivery (normal)」兩列。
- **Bug Investigation & Fix** ← SSOT 的「Bug Fix (unknown root cause)」列（根因未知，走 `bug-investigation` skill）；SSOT 的「Bug Fix (known root cause)」列也落在此 bucket 內，但跳過 investigation，直接走 inspect → tdd-guide RED → patch。
- **Lightweight Maintenance** ← SSOT 的「Lightweight Maintenance」列；SSOT 的「Medium change」列在本技能的三分類中沒有獨立 bucket，最接近的落點也是 Lightweight Maintenance（inspect → brief plan → patch），差異是 Medium change 多一步 brief plan。

## Progressive Loading Rules

1. 先讀當前 repo 的權威規範，例如 `CLAUDE.md`、`AGENTS.md`。
2. 先做 workflow 分流，未分流前不要讀 heavy references。
3. 只有符合下列條件才載入對應 reference：
   - 需要建立或補齊 profile：讀 [references/profile-and-project-overrides.md](references/profile-and-project-overrides.md)
   - 需要判斷 OpenSpec / Generic Docs readiness 與 gate：讀 [references/work-item-and-gates.md](references/work-item-and-gates.md)
   - 使用者明確要腳本、命令模板或 gate 指令：讀 [references/script-operations.md](references/script-operations.md)
   - workflow type 已確定為 `Feature Delivery`：讀 [references/workflow-feature-delivery.md](references/workflow-feature-delivery.md)
   - workflow type 已確定為 `Bug Investigation & Fix`：讀 [references/workflow-bugfix.md](references/workflow-bugfix.md)
   - workflow type 已確定為 `Lightweight Maintenance`：讀 [references/workflow-lightweight.md](references/workflow-lightweight.md)
   - 需要整理 completion gate、驗證項目或 handoff：讀 [references/handoff-and-verification.md](references/handoff-and-verification.md)
   - 需要 project-specific 範例、shortcut 或預填值：先讀 [references/projects-index.md](references/projects-index.md)
   - 正在維護舊索引連結，或還不確定要讀哪一份子 reference：讀 [references/workflow-analysis.md](references/workflow-analysis.md) 或 [references/workflow-checklists.md](references/workflow-checklists.md)
4. project pack 載入順序固定為：先讀 `projects-index.md`，再讀 `projects-generic.md`，最後若使用端專案提供了 `@rules/dev-workflow-project.md`（位於該專案 `.claude/rules/`）才讀它套用專案預填值與覆寫；若專案沒有提供，就停在 generic，不要硬套既有專案規則。

## Execution Order

1. 判斷這是不是本技能該處理的前置決策問題。
2. 選出 workflow type。
3. 只載入該 workflow 需要的 reference。
4. 回報 required artifacts、gate status、缺件與 next step。
5. 如果條件已經 apply-ready，結束本技能並 hand off 到下一個流程，不重跑前置。

## Planning-Phase Agent

分類完成後，立即依 workflow type 調用對應 agent（不等使用者確認）：

| Workflow Type | 條件 | 調用（codex-free 預設） |
|---|---|---|
| Bug Investigation & Fix | 根因未知 | `bug-investigation` skill |
| Feature Delivery | 跨模組或 DDD 層次重設計 | `subagent_type=dhpk:architect` |
| Feature Delivery | 一般新功能 | 無（直接進 work-item） |
| Lightweight Maintenance | — | 無（直接進 inspect → patch） |

立即啟動——不等待使用者確認。`--codex` 模式時，依「Codex mode」表改用 `/codex-brainstorm` /
`/codex-architect`。（注意：dhpk 沒有 `bug-investigator` agent；根因調查用 `bug-investigation` skill。）

## Implementation-Phase Agent

實作階段（Implement）的 dispatch 對應——SSOT 在 `@rules/execution-policy.md` →
*Implementation dispatch*，本表只列出 workflow 分類與典型調用，不重述決策表本身：

| Workflow Type | 條件 | 調用（codex-free 預設，`orchestration_dispatch=on`） |
|---|---|---|
| Bug Investigation & Fix | 根因未知 | `subagent_type=dhpk:deep-reasoner`（產出 fix spec 交給下一列） |
| Feature Delivery / Bug Investigation & Fix | 機械式、規格明確 | `subagent_type=dhpk:fast-worker` |
| Feature Delivery / Bug Investigation & Fix | 獨立第二視角、或外包自足規格任務（**CODEX=on**） | `subagent_type=dhpk:codex-bridge`（一次性 `codex exec`、輸出隔離、原文轉述；SSOT 見 execution-policy §Implementation dispatch） |
| Feature Delivery / Bug Investigation & Fix | 小改動（約 ≤2 檔、無歧義） | 無（inline，不經 dispatch） |
| Lightweight Maintenance | — | 無（直接 inline patch，本來就不進 heavy dispatch） |

一律禁止用 `general-purpose` 做實作 dispatch（同 execution-policy 條文）。`orchestration_dispatch=off`
時本表整體不生效，回到本節加入前的行為（`dhpk:bug-fix` / `dhpk:feature-dev` 內直接寫程式碼）。

## Post-Implementation Agent Gates

<!-- SSOT: @rules/execution-policy.md → Post-implementation agent gate。本節只保留「必須輸出 checklist」的指示；gate 的順序與觸發定義以 execution-policy.md 為準，衝突時以它為準。-->

回覆中**必須**輸出 Post-Implementation Agent Gate checklist——gate 的權威定義在
`@rules/execution-policy.md` → *Post-implementation agent gate (SSOT)*（依序
`tdd-guide → database-reviewer → security-reviewer → code-reviewer`，Lightweight Maintenance 以外的
所有路徑皆跑）。不要在此重述 gate 表格；讀取該 SSOT，依本次變更分類為每個 agent 預填 YES/NO
（`code-reviewer` 一律 YES）。

**Gate 失敗處理：** 任一 gate 失敗 → 修正 → 重跑該 gate → PASS 後才繼續下一個。不得跳過。

## Script Entry Points

- `prepare_workflow_profile.py`
  - 只在需要建立或更新 `profile.yaml`，或使用者明確要求下一步 command template 時提及
- `prepare_dev_scope.py`
  - 只在 `Feature Delivery` / `Bug Investigation & Fix` 需要建立 `dev-scope.md`、`legacy-reference.md` 或 Generic Docs 模板時提及
  - 若 `work-item-system` 是 `openspec`，目標 change directory 必須已存在
- `workflow_gate_check.py`
  - `feature` / `bugfix` 用於 heavy gate 檢查
  - `lightweight` 只能當作 skip confirmation；它不會取代 targeted verification
- `openspec_gate_check.py`
  - 只在 OpenSpec change 已存在，且需要確認 apply-ready / handoff 狀態時提及

## Output

回覆至少包含：

- `workflow type`
- `why this path`
- `required artifacts / skipped artifacts`
- `gate status`（PASS / FAIL / NOT NEEDED）
- `next step` 或 `next skill`

### Output Expectations by Workflow

- `Feature Delivery`：指出 profile、work-item、legacy、RED 是否齊全；缺件時明確阻擋實作
- `Bug Investigation & Fix`：指出 evidence、root cause path、work-item、legacy、RED 是否齊全；不要把缺 profile 當成單獨 blocker
- `Lightweight Maintenance`：明確列出哪些 heavy artifacts 要跳過，並保留至少一個 targeted verification

### Next Commands by Workflow

| Workflow Type | Planning | Next Command | Artifacts Required |
|---|---|---|---|
| Bug Investigation & Fix（根因未知）| `bug-investigation` skill | `/opsx:new` 或 brief plan | work-item + legacy-ref + RED |
| Feature Delivery（跨模組） | dhpk:architect | `/opsx:new` 或 brief plan | profile + work-item + legacy-ref + RED |
| Feature Delivery（一般） | — | `/opsx:new` 或 brief plan | profile + work-item + legacy-ref + RED |
| Lightweight Maintenance | — | Read → Edit | targeted verification only |

### Workflow ASCII Diagrams

輸出 handoff 時附上對應的流程圖：

**Feature Delivery:**
```
Requirements → OpenSpec or Brief Plan → TDD → Implement → Review
                  │                       │       │          │
                  ▼                       ▼       ▼          ▼
             /opsx:new 或 brief plan  tdd-guide  Edit   db+sec+code
                                                         reviewers
```

**Bug Investigation & Fix:**
```
Investigate → OpenSpec or Brief Plan → TDD → Implement → Review
     │            │                     │       │             │
     ▼            ▼                     ▼       ▼             ▼
bug-investigation /opsx:new 或 brief plan tdd-guide Edit  db+sec+dhpk:code-reviewers
```

**Lightweight Maintenance:**
```
Inspect → Patch → Review
   │        │        │
   ▼        ▼        ▼
  Read    Edit    dhpk:code-reviewer
```

## Verification

- [ ] 已選出單一 workflow type
- [ ] 回答未展開不必要的 heavy context
- [ ] 若為 `feature` / `bugfix`，已清楚說明 blockers 與 gate
- [ ] 若為 `lightweight`，已清楚說明 skip 項目與最小驗證
- [ ] 已指出下一個技能、流程或命令
