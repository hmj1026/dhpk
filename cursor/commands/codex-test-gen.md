---
name: codex-test-gen
description: "Deprecated alias for dhpk TDD test-generation mode."
---
**Deprecated forwarding alias.** Exact replacement:

`/dhpk:dhpk-tdd-workflow --mode test-generation $ARGUMENTS`

## Compatibility boundary

This explicit-only alias is retained for legacy callers; new work uses the
Codex-free TDD target directly. Generation never selects MCP.
See [the alias contract](https://github.com/hmj1026/dhpk/blob/main/docs/agent-guidance/command-aliases.md); preserve the target, flags, and `$ARGUMENTS`.
Completion: propagate the target's exit status and report its PASS/FAIL/verdict evidence.
