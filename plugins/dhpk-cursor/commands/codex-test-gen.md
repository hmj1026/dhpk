---
name: codex-test-gen
description: "Deprecated forwarding alias for dhpk TDD test-generation mode."
---
**Deprecated forwarding alias.** For this minor release, invoke
`dhpk-tdd-workflow` in `test-generation` mode with `$ARGUMENTS`.

## Compatibility boundary

This explicit-only alias is retained for legacy callers; new work uses the canonical target.
See [the alias contract](https://github.com/hmj1026/dhpk/blob/main/docs/agent-guidance/command-aliases.md); preserve the target, flags, and `$ARGUMENTS`.
Completion: propagate the target's exit status and report its PASS/FAIL/verdict evidence.
