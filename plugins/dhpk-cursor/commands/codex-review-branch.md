---
name: codex-review-branch
description: "Deprecated alias for feature-branch review."
---
**Deprecated forwarding alias.** Exact replacement (explicit CLI backend):

`/dhpk:dhpk-change-review --backend cli --scope branch --depth full $ARGUMENTS`

## Compatibility boundary

This explicit-only alias is retained for legacy callers; new work uses the
backend-neutral target directly. The replacement has no MCP fallback.
See [the alias contract](https://github.com/hmj1026/dhpk/blob/main/docs/agent-guidance/command-aliases.md); preserve the target, flags, and `$ARGUMENTS`.
Completion: propagate the target's exit status and report its PASS/FAIL/verdict evidence.
