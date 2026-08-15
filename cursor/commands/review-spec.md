---
name: review-spec
description: "Deprecated forwarding alias for Codex technical-spec review."
---
**Deprecated forwarding alias.** For this minor release, run:

`/dhpk:codex-review --scope doc --spec $ARGUMENTS`

## Compatibility boundary

This explicit-only alias is retained for legacy callers; new work uses the canonical target.
See [the alias contract](https://github.com/hmj1026/dhpk/blob/main/docs/agent-guidance/command-aliases.md); preserve the target, flags, and `$ARGUMENTS`.
Completion: propagate the target's exit status and report its PASS/FAIL/verdict evidence.
