---
name: codex-review-doc
description: "Deprecated alias for document review."
---
**Deprecated forwarding alias.** Exact replacement:

`/dhpk:dhpk-doc-review $ARGUMENTS`

## Compatibility boundary

This explicit-only alias is retained for legacy callers; new work uses the
backend-neutral target directly. The replacement runs without MCP.
See [the alias contract](https://github.com/hmj1026/dhpk/blob/main/docs/agent-guidance/command-aliases.md); preserve the target, flags, and `$ARGUMENTS`.
Completion: propagate the target's exit status and report its PASS/FAIL/verdict evidence.
