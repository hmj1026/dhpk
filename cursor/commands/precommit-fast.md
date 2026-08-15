---
name: precommit-fast
description: "Deprecated forwarding alias for fast pre-commit verification."
---
**Deprecated forwarding alias.** For this minor release, run:

`/dhpk:precommit --fast $ARGUMENTS`

## Compatibility boundary

This explicit-only alias is retained for legacy callers; new work uses the canonical target.
See [the alias contract](https://github.com/hmj1026/dhpk/blob/main/docs/agent-guidance/command-aliases.md); preserve the target, flags, and `$ARGUMENTS`.
Completion: propagate the target's exit status and report its PASS/FAIL/verdict evidence.
