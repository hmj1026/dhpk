---
description: 'Deprecated alias for dhpk TDD test-generation mode.'
argument-hint: '<target>'
metadata:
  dhpk-invocation-class: explicit-only
---

**Deprecated forwarding alias.** Forward to the workspace-write canonical
`$tdd-workflow` Skill’s `test-generation` action:

`$tdd-workflow test-generation $ARGUMENTS`

Not for: Playwright journey authoring, documentation or rename work, or replacing the `tdd-guide` dispatch; new callers use `$tdd-workflow` directly.

Preserve `$ARGUMENTS` unchanged and propagate the target status, generated-test
result, failure state, and PASS/FAIL/verdict evidence. Do not select MCP or
invent a replacement when the public owner resource is unavailable.
