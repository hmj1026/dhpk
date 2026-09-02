---
description: 'Deprecated alias for test and coverage review.'
metadata:
  dhpk-invocation-class: explicit-only
---

**Deprecated forwarding alias.** Exact replacement:

`/dhpk:dhpk-test-review --coverage $ARGUMENTS`

## Compatibility boundary

This explicit-only alias is retained for legacy callers; new work uses the
backend-neutral test-review target directly. The replacement runs without MCP.
See [the alias contract](../docs/agent-guidance/command-aliases.md); preserve the target, flags, and `$ARGUMENTS`.
Completion: propagate the target's exit status and report its PASS/FAIL/verdict evidence.
