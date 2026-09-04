---
name: flow-guide
argument-hint: '<help|route|rules|next|close> [--go] [<query>]'
description: 'Read-only workflow guidance and bounded routing. Use when work needs a route, policy lookup, next action, closeout gate, or Codex usage help. Not for implementation, review, code tracing, or skill authoring. Output: one typed report with evidence and a clear handoff.'
allowed-tools: 'Read, Grep, Glob, Bash, Skill, Agent'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Flow Guide

Use `$flow-guide <help|route|rules|next|close> [query]` to answer one workflow
question. The guide is advisory: it records evidence and hands work to the
owner; it does not acquire the owner's authority.

## When NOT to Use

- Implementing a confirmed change: invoke `$flow-drive <confirmed-spec-or-change-id>` directly.
- Reviewing a completed diff: use `change-verdict`.
- Tracing code or diagnosing a failure: use `code-trace`.
- Authoring or restructuring a skill: use `skill-forge`.

## Actions

| Action | Use when | Completion criterion |
| --- | --- | --- |
| `help` | Codex usage grammar or available skills is unclear | A catalog or one usage card is returned without loading target procedure text. |
| `route` | One workflow owner must be selected | A validated `dhpk.route-result.v3` report names the target, availability, evidence, and next action. |
| `rules` | A phase or policy question needs the repository source of truth | The applicable policy pointer and gates are reported; no downstream workflow starts. |
| `next` | Progression from the current worktree or change is unclear | One next route is recommended from current evidence. |
| `close` | The edit boundary is complete and handoff readiness must be checked | Changed files, required gates, open risks, and the handoff state are accounted for. |

Choose exactly one action. Load only the references named by that action, and
keep required, skipped, unavailable, and failed evidence distinct.

## `help`

Run `node skills/flow-guide/scripts/usage-card.js` for the generated Codex
catalog, or add one public skill name for a single usage card. Help is metadata
only: it never invokes the named skill, loads its procedural references, or
grants workspace, Git, or external-write authority. An unknown name and a known
non-Codex skill receive different diagnostics.

## `route`

1. Parse the action query with `scripts/route-result.js`.
2. Match `references/route-table.json` through `scripts/pre-route.sh`; the
   first precise match wins. A miss remains a deliberate-classification case.
3. Apply `rules/execution-policy.md` and the target's invocation class.
4. Without `--go`, return advice only. With `--go`, produce at most one
   bounded handoff for an available implicit-eligible target. An explicit-only
   target is reported as `explicit-required`; it is never dispatched here.
5. Validate and emit the closed `dhpk.route-result.v3` object. A route report
   is not implementation, review, commit, merge, archive, release, or deploy
   evidence.

The result has exactly `schema`, `action`, `host`, `cleanedQuery`, `options`,
`target`, `availability`, `diagnostics`, `disposition`, `requiredEvidence`, and
`nextAction`. `options` is exactly `{go: boolean}`. The target is either null or
`{id, publicName, invocationClass, command}`.

## `rules`

Read `rules/execution-policy.md` first. Use
`references/invocation-precedence.md` when more than one owner appears to
match, and load the phase-specific delivery reference only after the phase is
known. Return the source pointer, applicable gate, and one next handoff.

## `next`

Run `node skills/flow-guide/scripts/analyze.js` and parse its JSON. Report the
current branch/worktree evidence, each required or unavailable gate, and one
next route. If the script cannot run, record the fallback evidence and the
reason instead of treating the missing check as a pass.

## `close`

Account for changed files, TDD evidence when behavior changed, applicable
reviewers, triggered security/database/frontend/runtime checks, unresolved
risks, and the next handoff. Use `references/handoff-and-verification.md` and
`references/review-gate-mechanics.md` only when their conditional detail is
needed. Never claim commit, merge, release, deployment, or archive completion
from a local closeout report.

## Output

```text
Action → Route or gate → Required evidence → PASS/FAIL/NOT NEEDED/BLOCKED → Next action
```

The report must name one action, one next route, and the evidence boundary.
`route --go` still ends at a handoff; the selected target owns its own
execution and completion evidence.

## References

- `references/route-table.json`, `references/route-result.schema.json`,
  `scripts/pre-route.sh`, and `scripts/route-result.js` — deterministic route
  contract and matcher.
- `scripts/usage-card.js` and `references/codex-usage-catalog.json` —
  progressively disclosed Codex grammar.
- `references/invocation-precedence.md` — competing-owner resolution.
- `references/projects-index.md` — project-specific policy references.
- `references/progression-tables.md` — fallback progression for `next`.
- `references/handoff-and-verification.md` — conditional handoff evidence.
- `references/review-gate-mechanics.md` — conditional reviewer mechanics.
- `rules`: load `references/deterministic-first.md`,
  `references/dispatch-and-gates.md`, `references/implementation-dispatch.md`,
  `references/testing-policy.md`, or `references/component-addition-policy.md`
  only for the matching policy question; use
  `references/invocation-classification.md` or `references/codex-mode.md` only
  when invocation or Codex delegation is the disputed boundary.
- `next`: after classification, choose at most one of
  `references/workflow-analysis.md`, `references/workflow-bugfix.md`,
  `references/workflow-feature-delivery.md`, or
  `references/workflow-lightweight.md`. Load
  `references/task-modes.md`, `references/premise-verification.md`,
  `references/work-item-and-gates.md`, `references/delivery-core.md`, or
  `references/delivery-loop-gate.md` only when that selected branch points to
  it. Project overrides use `references/profile-and-project-overrides.md` and
  `references/projects-generic.md`.
- `close`: use `references/output-shape.md`, `references/anti-loop.md`, and
  `references/squash-merge-hygiene.md` only for their named closeout checks.
  `references/workflow-checklists.md` and `references/script-operations.md`
  remain conditional detail, not initial context.
- Legacy deterministic helpers `scripts/openspec_gate_check.py`,
  `scripts/prepare_dev_scope.py`, `scripts/prepare_workflow_profile.py`, and
  `scripts/workflow_gate_check.py` are run only when a selected rule or next
  branch explicitly requires their existing input/output contract.

## Verification

- [ ] Exactly one action was selected and its completion criterion is met.
- [ ] Only action-relevant references and scripts were loaded.
- [ ] Required, skipped, unavailable, and failed gates are distinct.
- [ ] A route report was validated as `dhpk.route-result.v3`.
- [ ] No target was executed and no target authority was inherited.
