---
description: 'Deprecated alias for security review.'
metadata:
  dhpk-invocation-class: explicit-only
---

**Deprecated forwarding alias.** Exact replacement:

`/dhpk:dhpk-security-review --scope $ARGUMENTS`

## Compatibility boundary

This explicit-only alias is retained for legacy callers; new work uses the
Codex-free security target directly. The replacement has no MCP fallback.
See [the alias contract](../docs/agent-guidance/command-aliases.md); preserve the target, flags, and `$ARGUMENTS`.
Completion: propagate the target's exit status and report its PASS/FAIL/verdict evidence.
