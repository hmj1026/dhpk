---
name: precommit-fast
description: "Deprecated forwarding alias for fast pre-commit verification."
---
**Deprecated forwarding alias.** Forward unchanged to the workspace-write
`$precommit` Skill in fast mode:

`$precommit --fast $ARGUMENTS`

Not for: ad hoc replacement checks, dependency audits, or read-only verification; new callers use `$precommit --fast` directly.

The owner controls runner resolution, mutation, stage order, changed-file
reporting, and terminal evidence. Propagate its status and report PASS/FAIL/
verdict evidence as `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, or `UNAVAILABLE`; do
not claim a pass from a plan or partial runner output.
