---
name: adaptive-dev-workflow
description: 'Workflow router for substantial changes. Use when: a feature, bugfix, refactor, security, perf, or OpenSpec change needs classifying into Feature Delivery, Bug Investigation & Fix, or Lightweight Maintenance before heavy context loads. Not for tiny edits, investigation already underway, code review, or apply-ready OpenSpec tasks. Output: workflow classification + required artifacts + gate checklist.'
argument-hint: '[--codex] <change description or current state>'
allowed-tools: 'Read, Grep, Glob, Bash, Skill, Agent'
---

# Adaptive Dev Workflow

## Overview

先做 workflow 分流，再決定是否需要 profile、scope、work-item、gate 等前置資產。
主檔只保留決策核心；分支細節由條件式 reference 提供。

## When NOT to Use

- `CLAUDE.md` Execution Policy 定義的 small change：直接 patch + `dhpk:code-reviewer`
- root-cause 調查已在進行：改用 `bug-investigation`
- 純架構或 module boundary 討論：改用 `software-architecture`
- OpenSpec change 已 apply-ready：切去 `/opsx:apply`
- 已進入 TDD 實作階段：改用 `tdd-guide` agent
- 只做 code review：改用專用 review skill

## Core Principles

1. 先選 workflow type，再載入 heavy context。
2. 以 repo 權威規範（例如 `CLAUDE.md`、`AGENTS.md`）為 SSOT；本技能只補 workflow 缺口。
3. `Lightweight Maintenance` 只做 targeted verification；`Feature Delivery` / `Bug Investigation & Fix` 才建立 heavy artifacts。
4. 缺件時回報 blocker；apply-ready 時直接 hand off，不重跑前置。

## Fast-worker invocation context

When `/dhpk:do` supplies `WORKER_OVERRIDE`, preserve that exact invocation-only value through hand-off to
`dhpk:bug-fix` / `dhpk:feature-dev`. Before the first mechanical dispatch, consume it with the shared selector at
`scripts/fast-worker-selector.js` using `--backend "$WORKER_OVERRIDE"`.
`unset` means omit the explicit backend argument and let the selector apply userConfig/default precedence; never infer it from cleaned task text.

## Codex mode (opt-in)

預設是 codex-free：不呼叫 `mcp__codex__*`，也不需要 Codex CLI/MCP。只有傳入 `--codex` 才載入
[references/codex-mode.md](references/codex-mode.md) 取得 phase mapping、fallback 與下游 `--codex` 規則。

## Workflow Decision

### Feature Delivery

新能力、行為變更、跨模組契約調整，或需要完整前置治理的變更。

### Bug Investigation & Fix

錯誤、效能、安全、資料異常等問題；先確認 evidence、root cause 與 regression path。`profile` 可選，但 work-item、legacy、RED 仍是 blocker。

### Lightweight Maintenance

不改行為的小修、純整理或局部重構；跳過 heavy artifacts，只保留 targeted verification 與 next step。

三個 bucket 對應 `@rules/execution-policy.md` 的六種 change type：Feature 對應兩種 Feature Delivery；Bug 對應 known/unknown root cause（known root cause 跳過 investigation，直接 inspect → tdd-guide RED → patch）；Medium change 落在 Lightweight，但多一步 brief plan。SSOT 表格優先。

## Progressive Loading Rules

1. 先讀當前 repo 的權威規範，再做 workflow 分流；分流前不讀 heavy reference。
2. workflow type 確定後，只讀該分支需要的 reference：
   - profile： [profile-and-project-overrides](references/profile-and-project-overrides.md)
   - work-item/gate： [work-item-and-gates](references/work-item-and-gates.md)
   - Feature： [workflow-feature-delivery](references/workflow-feature-delivery.md)
   - Bug： [workflow-bugfix](references/workflow-bugfix.md)
   - Lightweight： [workflow-lightweight](references/workflow-lightweight.md)
   - handoff/verification： [handoff-and-verification](references/handoff-and-verification.md)
   - planning、implementation 或 post-implementation gate： [dispatch-and-gates](references/dispatch-and-gates.md)
   - concrete commands： [script-operations](references/script-operations.md)
   - project pack：先讀 [projects-index](references/projects-index.md)，再依其規則讀 `projects-generic.md` 與 `@rules/dev-workflow-project.md`
3. 舊索引連結或 reference 不明時，才讀 [workflow-analysis](references/workflow-analysis.md) 或 [workflow-checklists](references/workflow-checklists.md)。
4. 沒有 `@rules/dev-workflow-project.md` 時停在 generic guidance，不套用既有專案 shortcut。

## Execution Order

1. **Triage**：確認請求是前置決策問題；否則指出正確 handoff。完成條件：已決定繼續或離開本技能。
2. **Classify**：選出恰好一個 workflow type。完成條件：類型與理由都可用請求內容解釋。
3. **Load**：只載入該類型和請求明確需要的 reference。完成條件：每個 required/skipped artifact 都有狀態。
4. **Plan**：分類後立即執行必要 planning dispatch，不等待確認；完整 dispatch 規則見 [dispatch-and-gates](references/dispatch-and-gates.md)。完成條件：dispatch 結果已記錄，或明確標示不需要。
5. **Report**：輸出 workflow、理由、artifact、gate、next step 與適用的 post-implementation checklist。完成條件：所有 Output 欄位均已填寫。
6. **Handoff**：若已 apply-ready，直接指向下一流程；若有 blocker，停止在實作前。完成條件：只有一個清楚的 next skill/command。

## Planning-Phase Agent

分類完成後立即執行，不等待使用者確認：

| 條件 | Codex-free planning |
|---|---|
| Bug Investigation & Fix，根因未知 | `bug-investigation` skill |
| Feature Delivery，跨模組或 DDD 重設計 | `subagent_type=dhpk:architect` |
| 其他 Feature / Lightweight | 無，直接進 work-item 或 inspect → patch |

`--codex` 的替代路徑與 dispatch 結果格式見 [codex-mode](references/codex-mode.md) 和 [dispatch-and-gates](references/dispatch-and-gates.md)。

## Implementation and Post-Implementation Gates

需要 implementation dispatch、reviewer batching、failure handling、next command 或流程圖時，讀 [dispatch-and-gates](references/dispatch-and-gates.md)。每次回覆都必須輸出適用的 Post-Implementation Agent Gate checklist；其順序與觸發定義以 `@rules/execution-policy.md` SSOT 為準。

## Script Entry Points

需要具體命令時讀 [script-operations](references/script-operations.md)；該檔定義 `prepare_workflow_profile.py`、`prepare_dev_scope.py`、`workflow_gate_check.py` 與 `openspec_gate_check.py` 的前置條件與模板。

## Output

回覆至少包含：

- `workflow type` 與 `why this path`
- `required artifacts / skipped artifacts`
- `gate status`（PASS / FAIL / NOT NEEDED）與 blockers
- `next step` 或 `next skill`
- 適用的 post-implementation gate checklist

分支最低要求：Feature 要交代 profile/work-item/legacy/RED；Bug 要交代 evidence/root-cause path/work-item/legacy/RED，缺 profile 不得單獨擋住；Lightweight 要列出 heavy skip 項目並保留 targeted verification。

## Verification

- [ ] 恰好選出一個 workflow type，理由與請求一致
- [ ] 未載入不必要的 heavy context
- [ ] required/skipped artifacts 與 gate status 清楚
- [ ] 必要 planning dispatch 已完成或標示不需要
- [ ] 已指出唯一的 next skill/command 與適用 gate checklist
