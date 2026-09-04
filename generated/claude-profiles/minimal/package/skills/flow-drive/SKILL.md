---
name: flow-drive
argument-hint: '<confirmed-spec-or-change-id> [--plan[=<model>:<effort>]] [--worker=<claude|codex|agy|auto>] [--reasoner=<backend>:<model>:<effort>] [--architect|--no-architect]'
description: 'Explicit-only implementation workflow for a confirmed specification or OpenSpec change whose target and acceptance contract are settled. Not for route selection, proposal authoring, review, debugging without a confirmed cause, or release. Output: ordered implementation and verification evidence, or an explicit blocker.'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

# Flow Drive

Use `$flow-drive <confirmed-spec-or-change-id> [implementation-options]` only
after the specification, target, and acceptance boundary are confirmed. Use
`flow-guide route` when ownership is unclear; use the external OpenSpec
authoring owner when a proposal or artifact is still missing.

## When NOT to Use

- The route, target, or acceptance contract is unclear: use `$flow-guide route`.
- A proposal or OpenSpec artifact still needs authoring: use external `$openspec-propose`.
- The task is review-only or diagnostic-only: use `change-verdict` or `code-trace`.
- Commit, release, deployment, or archive authority has not been separately granted.

## Boundary

Flow Drive owns implementation of the confirmed work. It does not choose a
route, author a proposal, review an existing diff, or claim archive, commit,
merge, release, deployment, or pilot evidence. Its explicit-only boundary is
preserved even when a caller presents a ready-looking route.

## Implementation contract

1. Read the confirmed specification or change artifacts in order. Resolve
   repository instructions, context, target files, nearby tests, and the
   verification commands before editing.
2. Convert the work into dependency-ordered observable items. Preserve
   OpenSpec task order and leave incomplete tasks unchecked.
   An OpenSpec apply with two or more unchecked tasks requires the planner
   gate before workspace writes; record the policy-approved skip for one task.
3. At each behavior boundary, run the smallest non-tautological test first,
   make the smallest compatible edit, inspect the diff, and run the focused
   verification. Preserve unrelated dirty work.
4. Keep planner, worker, reasoner, and architecture choices within the
   implementation policy. Optional backends are explicit and cannot silently
   replace the current implementer.
5. Stop on an evidence-changing blocker. A rejected or modified item may be
   retried at most twice with its failure and current diff supplied as context.

Completion means every ordered item has implementation and verification
evidence, or the report names the exact blocker, skipped check, and resume
action.

## Implementation options

- `--plan[=<model>:<effort>]` requests a planning pass.
- `--worker=<claude|codex|agy|auto>` selects an explicitly requested worker.
- `--reasoner=<backend>:<model>:<effort>` requests a bounded second opinion.
- `--architect` or `--no-architect` controls the architecture pass.
- `--codex` is a retired diagnostic and produces a blocking report; it never
  grants a peer, backend, or execution shortcut.

These options refine confirmed implementation work; they do not change its
owner or completion contract.

## Output

Report the ordered work items, changed files, tests and static checks, retry
state, unresolved risks, and next handoff. Mark missing evidence as `BLOCKED`
or `NOT RUN`. Keep implementation, verification, and archive as separate
states.

## References

- `rules/execution-policy.md` — invocation, planning, dispatch, and handoff
  policy.
- `skills/flow-guide/SKILL.md` — route, rules, progression, closeout, and usage
  discovery owner.
- `docs/agent-guidance/writing-for-agents.md` — document boundaries when the
  confirmed change edits agent-facing instructions.

## Verification

- [ ] A confirmed specification or change identifier was supplied.
- [ ] Repository context and verification commands were read before edits.
- [ ] Work was ordered by dependency and each item has observable evidence.
- [ ] Retried items stay within the two-attempt ceiling.
- [ ] OpenSpec task state, unresolved blockers, and next handoff are explicit.
