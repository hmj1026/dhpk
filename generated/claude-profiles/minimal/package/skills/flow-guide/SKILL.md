---
name: flow-guide
argument-hint: '--mode <classify|policy|next|checklist> [--go] [--feature <key>]'
description: 'Guide repository work through classification, execution policy, next-action advice, or final checklist. Use when: a change needs a workflow route, gates, progression advice, or wrap-up accounting. Not for: implementing the selected change, pure code tracing, or a review-only request. Output: one route or gate report with required artifacts, evidence, and a clear handoff.'
allowed-tools: 'Read, Grep, Glob, Bash, Skill, Agent'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Flow Guide

Select exactly one mode. This skill decides and verifies the route; it does
not implement the change. Project rules and `rules/execution-policy.md` remain
the single source of truth for routing and execution policy.

## When NOT to Use

- Execute a routed implementation or OpenSpec task → use `flow-drive` or the
  explicit OpenSpec apply route.
- Review a code, pull request, security surface, test suite, or document → use
  `change-verdict`.
- Understand or trace application code → use `code-trace`.
- Create or refactor a skill → use `skill-forge`.

## Mode selection

| Mode | Select when | Primary evidence |
| --- | --- | --- |
| `classify` | A substantial change needs one workflow bucket and readiness gates | Repository policy, change intent, required artifacts |
| `policy` | Kickoff, OpenSpec routing, post-edit closure, retry, or blocked output is unclear | Policy SSOT and the matching gate reference |
| `next` | The user asks what to do next or progression is unclear | `analyze.js` findings and progression table |
| `checklist` | The final edit wave is complete and a wrap-up gate is due | Changed files, reviewer state, tests, and handoff evidence |

## Shared workflow

1. Resolve project-local instructions and the policy SSOT before choosing a
   route. Done means precedence and current worktree state are known.
2. Select one mode and load only its branch references. Record required,
   skipped, and unavailable gates rather than treating a skip as a pass.
3. Collect deterministic evidence first. Make judgment only after the evidence
   is captured, and stop on a blocker that changes the route.
4. Report one next route or a closeout gate. Done means the handoff command,
   evidence requirement, and unresolved risk are explicit.

## `classify`

Choose exactly one bucket: `feature` for new behavior or contracts, `bugfix`
for an error, regression, security, performance, or data anomaly, or
`lightweight` for behavior-preserving maintenance. Load the matching
`workflow-feature-delivery.md`, `workflow-bugfix.md`, or
`workflow-lightweight.md`. Feature and bugfix branches account for requirements
or evidence, design or root cause, work item, legacy behavior, RED/regression,
tests, freshness, review, and handoff; lightweight keeps targeted verification.

Use `dispatch-and-gates.md` for planning or implementation gate dispatch,
`handoff-and-verification.md` for closeout, and `work-item-and-gates.md` for
artifact readiness. Load project packs only through `projects-index.md` and
the selected `projects-generic.md` or override. Use `workflow-analysis.md` for
multi-session decision maps and `workflow-checklists.md` for a compact audit.

## `policy`

Name the phase (`kickoff`, `implementation`, `post-edit`, or `blocked/retry`),
honor an explicit route, and choose one next action. Load
`invocation-classification.md` or `invocation-precedence.md` for competing
owners, `task-modes.md` for examples, and `delivery-core.md` plus
`delivery-loop-gate.md` for feature/bug handoff. Load
`implementation-dispatch.md` for worker selection, `review-gate-mechanics.md`
for reviewer closure, `anti-loop.md` for a retry ceiling, and `output-shape.md`
for blocked or completion wording. `deterministic-first.md`,
`premise-verification.md`, `testing-policy.md`, `component-addition-policy.md`,
and `squash-merge-hygiene.md` are conditional references, not a default bundle.

## `next`

Run `node skills/flow-guide/scripts/analyze.js` and parse its JSON. Without
`--go`, advise only. With `--go`, dispatch a high-confidence implicit target
only when there is no P0 and the target is executable; report explicit-only
targets without invoking them. If the script is unavailable, collect branch,
status, changed paths, review state, and policy evidence manually. Load
`progression-tables.md` only for fallback or an unclear phase.

## `checklist`

Run at the final edit boundary. Account for the TDD pre-run when business
behavior changed, every applicable reviewer gate, edit-before-read, triggered
security/database/frontend/runtime checks, and task-end bookkeeping. Use the
policy SSOT for sentinel definitions; use `review-gate-mechanics.md` only when
triaging, resuming, or backfilling a reviewer. Never claim a clean handoff while
an applicable gate is open.

## Output

```text
Mode → Route or gate → Required evidence → PASS/FAIL/NOT NEEDED/BLOCKED → Next action
```

`classify` includes bucket and artifacts; `policy` includes phase and one route;
`next` includes findings and confidence; `checklist` includes changed files,
verification, and risks/open questions.

## Verification

- [ ] Exactly one mode and one next route were selected.
- [ ] Only branch-relevant references and scripts were loaded.
- [ ] Required, skipped, unavailable, and failed gates are distinct.
- [ ] `analyze.js` ran for `next`, or its fallback evidence is recorded.
- [ ] The report contains an observable handoff and does not claim implementation or review completion.

## References

- `codex-mode.md`, `dispatch-and-gates.md`, `handoff-and-verification.md` — optional dispatch and handoff mechanics.
- `profile-and-project-overrides.md`, `projects-generic.md`, `projects-index.md` — project-profile resolution.
- `script-operations.md`, `workflow-analysis.md`, `workflow-bugfix.md`, `workflow-checklists.md` — workflow evidence and scripts.
- `workflow-feature-delivery.md`, `workflow-lightweight.md`, `work-item-and-gates.md` — classify branch detail.
- `anti-loop.md`, `component-addition-policy.md`, `deterministic-first.md`, `premise-verification.md` — conditional policy guards.
- `delivery-core.md`, `delivery-loop-gate.md`, `implementation-dispatch.md` — delivery and worker gates.
- `invocation-classification.md`, `invocation-precedence.md`, `output-shape.md`, `task-modes.md` — route precedence and output.
- `review-gate-mechanics.md`, `squash-merge-hygiene.md`, `testing-policy.md` — review, merge, and test gates.
- `progression-tables.md` — `next` fallback progression.

## Scripts

- `analyze.js` — deterministic next-step findings JSON.
- `openspec_gate_check.py` — OpenSpec apply-readiness gate.
- `prepare_dev_scope.py` — change-scoped helper preview or preparation.
- `prepare_workflow_profile.py` — generic workflow profile generation.
- `workflow_gate_check.py` — profile, work-item, legacy, and RED gate check.
