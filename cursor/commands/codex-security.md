---
name: codex-security
description: "Deprecated alias for security review."
---
**Deprecated forwarding alias.** Exact replacement:

`/dhpk:dhpk-security-review --scope $ARGUMENTS`

## Compatibility boundary

This explicit-only alias is retained for legacy callers; new work uses the
Codex-free security target directly. The replacement has no MCP fallback.
See [the alias contract](https://github.com/hmj1026/dhpk/blob/main/docs/agent-guidance/command-aliases.md); preserve the target, flags, and `$ARGUMENTS`.
Completion: propagate the target's exit status and report its PASS/FAIL/verdict evidence.
