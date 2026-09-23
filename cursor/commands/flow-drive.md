---
name: flow-drive
description: "Short Claude front door for explicit-only implementation of a confirmed specification or OpenSpec change."
---
# `/dhpk:flow-drive`

This is a thin Host front door to the canonical `$flow-drive` Skill. Forward
the supplied confirmed specification or change identifier and implementation
options unchanged; the Skill owns planning, editing, verification, authority,
and terminal evidence.

Not for: route selection, proposal authoring, review, debugging without a confirmed cause, or release.

`--worker=<worker>` remains the Worker Selector. Use
`--worker-target=<provider>/<model>[:<effort>]` for an explicit execution
target. The retired `--codex` diagnostic remains owned by the canonical Skill.

This front door does not add a mode, route selection, proposal authoring,
procedure, or second Usage Grammar.

Completion: report the canonical Skill result and preserve its `PASS`,
`BLOCKED`, `NOT_RUN`, or `UNAVAILABLE` evidence state.
