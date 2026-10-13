---
description: 'Short Claude front door for explicit-only implementation of a bounded task with settled acceptance.'
argument-hint: '<task-text|task-file|confirmed-spec-or-change-id> [--plan[=<model>:<effort>]] [--plan-mode=auto|bounded|discovery] [--worker=<worker>] [--worker-target=<provider>/<model>[:<effort>]] [--cross-provider] [--reasoner=<provider>[/<model>[:<effort>]]] [--architect|--no-architect]'
allowed-tools: 'Read, Grep, Glob, Bash, Skill, Agent'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

# `/dhpk:flow-drive`

This is a thin Host front door to the canonical `$flow-drive` Skill. Forward
the supplied task text, task file, or confirmed identifier and implementation
options unchanged; the Skill owns planning, editing, verification, authority,
and terminal evidence. Keep the task input as one argument; quote multiword
text or paths containing spaces, for example
`/dhpk:flow-drive "Fix checkout flow and verify receipt totals" --worker=codex`.

Not for: route selection, proposal authoring, review, diagnosis without a settled outcome, or release.

`--worker=<worker>` remains the Worker Selector. Use
`--worker-target=<provider>/<model>[:<effort>]` for an explicit execution
target. The retired `--codex` diagnostic remains owned by the canonical Skill.
The command has no route or workflow mode of its own. When supplied with
`--plan`, `--plan-mode=auto|bounded|discovery` is forwarded unchanged as the
planner consult scope.

This front door does not add a separate route or workflow mode, route
selection, proposal-authoring procedure, or second Usage Grammar.

Completion: report the canonical Skill result and preserve its `PASS`,
`BLOCKED`, `NOT_RUN`, or `UNAVAILABLE` evidence state.
