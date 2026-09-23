---
name: opsx-apply-resume
description: "Short Claude front door for explicit-only $opsx-apply-resume context handoffs."
---
# `/dhpk:opsx-apply-resume`

This is a thin Claude front door to the canonical `$opsx-apply-resume` Skill.
Forward `$ARGUMENTS` unchanged; the Skill owns phase detection, handoff state,
optional commit/precommit/compact/memory gates, and live-worktree evidence.

Not for: starting a new proposal, changing the external OpenSpec workflow, or treating a commit as a prerequisite.

The Skill keeps uncommitted files as the source of truth, uses the host's
receipt/artifact root, and hands successful continuation to the canonical
`openspec-apply-change` Skill. It must
never pass the `opsx:apply` human-command alias to the Skill tool, and it does
not change the external OpenSpec Skill.

Completion: return the canonical Skill result and preserve its `saved`,
`consuming`, `consumed`, `BLOCKED`, `UNAVAILABLE`, or `NOT_RUN` evidence state.
