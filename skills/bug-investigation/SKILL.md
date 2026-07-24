---
name: bug-investigation
description: 'Root-cause investigation workflow for unexpected behavior, test failures, performance regressions, data inconsistencies, and cross-layer data-flow tracing. Use when users ask to investigate or trace a bug, regression, flaky test, or root cause (including 測試失敗、效能異常、調查 Bug、追蹤資料流). Not for direct implementation when the root cause is already confirmed, ordinary code review, or pure feature work. Output: a phase-based evidence report, confirmed root cause or explicit blocked state, solution options, stop-loss state, and next actions.'
---

# Bug Investigation Skill

## Overview

Use a five-phase evidence loop to move from symptom to root cause, then to a bounded repair handoff:

`Clarify → Gather evidence → Trace and confirm → Design the fix → Preserve knowledge`

Keep the investigation record current. Every conclusion must point to evidence; every unresolved claim must be labelled as a hypothesis or blocker.

## When NOT to Use

- Root cause is confirmed and the user wants implementation: hand off to `dhpk:bug-fix`.
- The task is ordinary code or document review: use the relevant review skill.
- The task is pure feature development with no failure, regression, or inconsistency: use `adaptive-dev-workflow` / `feature-dev`.

## Core Contract

1. Complete all five phases. If a phase is blocked, record the missing evidence, blocker, and next action in the investigation document before stopping.
2. Do not propose a fix or edit production code until Phase 3 has a confirmed root cause and a minimal verification result.
3. Preserve raw logs, code, query, field, and test names; write explanations and documents in Traditional Chinese unless the project requires another language.
4. Follow the repository's `AGENTS.md`, `CLAUDE.md`, and execution-policy SSOT before choosing tools, artifacts, or OpenSpec routing. In dhpk-style repositories this means reading `rules/execution-policy.md` "Change classification & OpenSpec routing (SSOT)" and explicitly selecting either OpenSpec (`/opsx:new`) or a brief-plan handoff; OpenSpec is not unconditional.

## Execution Order

### Phase 1 — Problem Clarification

- Extract the expected/actual difference, sample IDs or timestamps, reproducibility, scope, and environment from the prompt and repository evidence.
- Ask only for facts that are still missing and block the phase; create `docs/knowledge/[feature-name]/investigation.md` from [phase-templates](references/phase-templates.md).
- Done when: the document contains the symptom, impact/scope, reproduction state, environment, and explicit evidence gaps.

### Phase 2 — Evidence Gathering

- Collect logs, runtime observations, database/query evidence when the database is in the path, and input/output at each layer of a multi-component flow.
- For database-backed symptoms, record table names, key fields, query text or ORM/repository calls, before/after values, and the command or read-only probe used to confirm them.
- For cross-layer flows, trace frontend input, API/request payload, service or background-job transformation, persistence, emitted events/logs, and rendered or downstream output until the first divergence is found.
- Record contradictions rather than explaining them away; use [scripts](references/scripts.md) only when a bundled command adds deterministic coverage.
- Done when: every material claim has a source location or command result, and the remaining contradictions are listed.

### Phase 3 — Root-Cause Confirmation

- Trace the complete data and call path, compare it with a known-good path, and identify the first divergence. For deep stacks, load [root-cause-tracing](references/root-cause-tracing.md).
- When the bug crosses a database or integration boundary, prove whether the value is already wrong before persistence, becomes wrong during persistence/querying, or is correct in storage but misread later.
- Write one hypothesis: “I believe X is the root cause because Y.” Test it with the smallest safe check, failing regression test, or reproducible probe.
- Done when: one root cause is supported by file:line, log, query, or test evidence and the regression path is stated. If the check fails, return to the trace and revise the hypothesis; do not advance with an unconfirmed cause.

### Phase 4 — Solution Design and Handoff

- Create `solution-proposal.md` with 2–3 options, trade-offs, impact, tests, rollback, and one recommendation; use [phase-templates](references/phase-templates.md).
- Create a minimal reproduction or failing regression test. For flaky or timeout behavior, load [condition-based-waiting](references/condition-based-waiting.md) and copy [wait-for-helper.ts](references/wait-for-helper.ts) only when needed.
- Follow the repository execution-policy decision: if OpenSpec is selected, use `/opsx:new` and stop for artifact review; otherwise produce a brief plan and hand off to the TDD/implementation route. Do not silently choose between them.
- Apply stop-loss during repair planning and follow-up: after two failed fix attempts, return to Phase 1-3 and re-check the evidence chain; after three failed attempts, stop implementation and discuss the architecture or design issue before another patch.
- Done when: the recommendation is evidence-backed, its risks and verification are explicit, and exactly one next handoff is named.

### Phase 5 — Knowledge Preservation

- Check the existing knowledge base before adding files. Update the applicable `data-flow.md`, `key-functions.md`, and `related-tables.md` records from [phase-templates](references/phase-templates.md).
- Apply [defense-in-depth](references/defense-in-depth.md) when the fix needs protections at multiple boundaries, and use [checklists](references/checklists.md) to close the investigation.
- Done when: the investigation, solution proposal, evidence path, and reusable knowledge links agree; the checklist records completed and blocked items.

## Progressive Loading

Load only the reference needed by the current phase or branch:

- [phase-templates](references/phase-templates.md): creating or updating investigation, proposal, SQL, evidence, or knowledge files.
- [root-cause-tracing](references/root-cause-tracing.md): deep call-stack tracing, stack capture, or test-pollution isolation.
- [scripts](references/scripts.md): exact bundled commands; the available scripts are `check-tools.sh`, `trace-data-flow.sh`, `search-database-queries.sh`, `analyze-function-calls.sh`, `generate-flow-diagram.sh`, and `find-polluter.sh`.
- [condition-based-waiting](references/condition-based-waiting.md) and [wait-for-helper.ts](references/wait-for-helper.ts): flaky or asynchronous timing behavior.
- [defense-in-depth](references/defense-in-depth.md): layered validation, environment protection, or forensic logging.
- [examples](references/examples.md): a neutral report example or document shape.
- [checklists](references/checklists.md): final completeness review or Phase 5 closeout.

## Output

Return a phase-based report containing:

- symptom, expected/actual behavior, impact, scope, reproduction status, and evidence gaps;
- evidence with file:line, log, query, command, or test references;
- one confirmed root cause, or an explicit blocked state with the next evidence request;
- `docs/knowledge/[feature-name]/investigation.md` and `solution-proposal.md` status;
- 2–3 solution options, one recommendation, risks, tests, rollback, and exactly one next action.

Report hypotheses as hypotheses. Do not turn an untested runtime, browser, environment, or timing assumption into a root-cause statement.

## Verification

- [ ] All five phases are complete, or the current phase records a blocker, evidence gap, and next action.
- [ ] Phase 1–3 evidence is traceable and the root cause is singular and minimally verified.
- [ ] Phase 4 contains 2–3 options, one recommendation, regression evidence, risks, and rollback/verification intent.
- [ ] OpenSpec versus brief-plan routing is explicit and the next handoff is unique.
- [ ] Stop-loss state is recorded when repeated repair attempts have occurred: two failures returns to investigation, three failures stops for design discussion.
- [ ] Phase 5 knowledge files and the checklist agree with the investigation record.
