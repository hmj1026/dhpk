---
description: 'Deprecated forwarding alias for fast pre-commit verification.'
metadata:
  dhpk-invocation-class: explicit-only
---

**Deprecated forwarding alias.** For this minor release, run:

`/dhpk:precommit --fast $ARGUMENTS`

## Compatibility boundary

This explicit-only alias is retained for legacy callers; new work uses the canonical target.
See [the alias contract](../docs/agent-guidance/command-aliases.md); preserve the target, flags, and `$ARGUMENTS`.
Completion: propagate the target's exit status and report its PASS/FAIL/verdict evidence.
