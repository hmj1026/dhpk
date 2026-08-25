---
name: dhpk-adaptive-dev-workflow
description: 'Adaptive delivery workflow for substantial changes. Use when: a feature, bugfix, refactor, security, perf, or OpenSpec change needs one classification into Feature Delivery, Bug Investigation & Fix, or Lightweight Maintenance, with branch behavior and gates before heavy context loads. Not for tiny edits, investigation already underway, code review, or apply-ready OpenSpec tasks. Output: workflow classification + branch artifacts + delivery-loop gate checklist.'
argument-hint: '[--codex] <change description or current state>'
allowed-tools: 'Read, Grep, Glob, Bash, Skill, Agent'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Adaptive Dev Workflow

## Overview

先做 workflow 分流，再決定是否需要 profile、scope、work-item、gate 等前置資產。
主檔只保留決策核心；分支細節由條件式 reference 提供。

## When NOT to Use

- `CLAUDE.md` Execution Policy 定義的 small change：直接 patch + the designated code-reviewer agent
- Root-cause 調查已在進行：改用 `dhpk-root-cause-investigation`
- 純架構或 module boundary 討論：改用 `dhpk-module-design`
- OpenSpec change 已 apply-ready：切去 `/opsx:apply`
- 已進入 TDD 實作階段：改用 `tdd-guide` agent
- 只做 code review：改用專用 review skill

## Core Principles

1. 先選 workflow type，再載入 heavy context。
2. 以 repo 權威規範（例如 `CLAUDE.md`、`AGENTS.md`）為 SSOT；本技能只補 workflow 缺口。
3. `Lightweight Maintenance` 只做 targeted verification；`Feature Delivery` / `Bug Investigation & Fix` 才建立 heavy artifacts。
4. 缺件時回報 blocker；apply-ready 時直接 hand off，不重跑前置。
5. Feature and Bug work stay on their selected branch through implementation;
   shared test, freshness, review, and handoff rules live in the execution-policy
   delivery-loop reference。

## Wayfinder checkpoint

When the destination is unclear and work spans sessions or agents, load
[workflow-analysis](references/workflow-analysis.md) and record its bounded
decision-map fields before implementation; clear one-session work skips it.

## Fast-worker invocation context

When `/dhpk:do` supplies `WORKER_OVERRIDE`, preserve that exact invocation-only
value through the selected Feature or Bug branch. Before the first mechanical
dispatch, consume it with the shared selector at `scripts/fast-worker-selector.js`
using `--backend "$WORKER_OVERRIDE"`.
`unset` means omit the explicit backend argument and let the selector apply userConfig/default precedence; never infer it from cleaned task text.

## Codex mode (opt-in)

預設是 codex-free：不呼叫 `mcp__codex__*`，也不需要 Codex CLI/MCP。只有傳入 `--codex` 才載入
[references/codex-mode.md](references/codex-mode.md) 取得 phase mapping、fallback 與下游 `--codex` 規則。

## Workflow Decision

### Feature branch — Feature Delivery

新能力、行為變更或跨模組契約調整；讀
[workflow-feature-delivery](references/workflow-feature-delivery.md) 依
**requirements → design → artifacts → RED → implement**，再走 shared
delivery loop (`dhpk-tdd-workflow`, `dhpk-change-review`)。實作留在本 branch。

### Bug branch — Bug Investigation & Fix

錯誤、效能、安全或資料異常；讀
[workflow-bugfix](references/workflow-bugfix.md) 依 **evidence → root cause →
regression test → minimal fix**，再走 shared delivery loop
(`dhpk-tdd-workflow`, `dhpk-change-review`)。已確認根因不重複調查，未知根因才 hand off。

### Lightweight Maintenance

不改行為的小修、純整理或局部重構；跳過 heavy artifacts，只保留 targeted verification 與 next step。

三個 bucket 對應 `@rules/execution-policy.md` 的六種 change type：Feature 對應兩種 Feature Delivery；Bug 對應 known/unknown root cause（known root cause 跳過重複調查，直接 evidence → tdd-guide RED → patch）；Medium change 落在 Lightweight，但多一步 brief plan。SSOT 表格優先。

## Progressive Loading Rules

1. 先讀當前 repo 的權威規範，再做 workflow 分流；分流前不讀 heavy reference。
2. workflow type 確定後，只讀該分支需要的 reference：
   - profile： [profile-and-project-overrides](references/profile-and-project-overrides.md)
   - work-item/gate： [work-item-and-gates](references/work-item-and-gates.md)
   - Feature： [workflow-feature-delivery](references/workflow-feature-delivery.md)
   - Bug： [workflow-bugfix](references/workflow-bugfix.md)
   - Lightweight： [workflow-lightweight](references/workflow-lightweight.md)
   - shared Feature/Bug delivery loop： `@skills/dhpk-execution-policy/references/delivery-loop-gate.md`
   - handoff/verification： [handoff-and-verification](references/handoff-and-verification.md)
   - planning、implementation 或 post-implementation gate： [dispatch-and-gates](references/dispatch-and-gates.md)
   - concrete commands： [script-operations](references/script-operations.md)
   - project pack：先讀 [projects-index](references/projects-index.md)，再依其規則讀 `projects-generic.md` 與 `@rules/dev-workflow-project.md`
3. 舊索引連結或 reference 不明時，才讀 [workflow-analysis](references/workflow-analysis.md) 或 [workflow-checklists](references/workflow-checklists.md)。
4. 沒有 `@rules/dev-workflow-project.md` 時停在 generic guidance，不套用既有專案 shortcut。

## Execution Order

1. **Triage**：確認是前置決策問題，否則指出正確 handoff。
2. **Classify**：選出恰好一個 workflow type，並記錄理由。
3. **Load**：只載入該類型和請求需要的 references，標記 required/skipped artifacts。
4. **Plan**：立即執行必要 planning dispatch；規則見 [dispatch-and-gates](references/dispatch-and-gates.md)。
5. **Execute**：依選定 branch reference；Feature/Bug 共用 `delivery-loop-gate`，Lightweight 直接 inspect → patch。
6. **Report**：輸出 workflow、理由、artifacts、gates、next step 與 post-implementation checklist。
7. **Handoff**：apply-ready 指向下一流程；blocker 停在實作前並給唯一 next skill/command。

Feature and confirmed Bug implementation remain within this skill. Unknown
causes hand off to `dhpk-root-cause-investigation`, architecture decisions to
`architect`, test strategy to `dhpk-tdd-workflow`, and code review to
`dhpk-change-review`.

## Planning-Phase Agent

分類完成後立即執行，不等待使用者確認：

| 條件 | Codex-free planning |
|---|---|
| Bug Investigation & Fix，根因未知 | `dhpk-root-cause-investigation` skill |
| Feature Delivery，跨模組或 DDD 重設計 | `subagent_type=dhpk:architect` |
| 其他 Feature / Lightweight | 無，直接進 work-item 或 inspect → patch |

`--codex` 的替代路徑與 dispatch 結果格式見 [codex-mode](references/codex-mode.md) 和 [dispatch-and-gates](references/dispatch-and-gates.md)。

## Implementation and Post-Implementation Gates

需要 implementation dispatch、reviewer batching、failure handling、next command 或流程圖時，讀 [dispatch-and-gates](references/dispatch-and-gates.md)；需要測試、adequacy、freshness、review 與 handoff 狀態時，讀 execution-policy 的 `@skills/dhpk-execution-policy/references/delivery-loop-gate.md`。每次回覆都必須輸出適用的 Post-Implementation Agent Gate checklist；其順序與觸發定義以 `@rules/execution-policy.md` SSOT 為準。

## Script Entry Points

需要具體命令時讀 [script-operations](references/script-operations.md)；該檔定義 `prepare_workflow_profile.py`、`prepare_dev_scope.py`、`workflow_gate_check.py` 與 `openspec_gate_check.py` 的前置條件與模板。

## Output

回覆至少包含：

- `workflow type` 與 `why this path`
- `required artifacts / skipped artifacts`
- `gate status`（PASS / FAIL / NOT NEEDED）與 blockers
- `next step` 或 `next skill`
- 適用的 post-implementation gate checklist

分支最低要求：Feature 要交代 requirements/design/profile/work-item/legacy/RED；Bug 要交代 evidence/root-cause path/work-item/legacy/RED，缺 profile 不得單獨擋住；兩者都要交代 delivery-loop 的 test/adequacy/freshness/review 狀態；Lightweight 要列出 heavy skip 項目並保留 targeted verification。

## Verification

- [ ] 恰好選出一個 workflow type，理由與請求一致
- [ ] Feature 或 Bug branch 的 requirements/evidence、設計/root-cause、RED/regression 與實作狀態已交代
- [ ] 未載入不必要的 heavy context
- [ ] required/skipped artifacts 與 gate status 清楚
- [ ] delivery-loop 的測試、adequacy、freshness、review 與 handoff 狀態清楚
- [ ] 必要 planning dispatch 已完成或標示不需要
- [ ] 已指出唯一的 next skill/command 與適用 gate checklist
