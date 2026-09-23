---
description: 'Deprecated forwarding alias for Codex test coverage review.'
argument-hint: '[<target>]'
metadata:
  dhpk-invocation-class: explicit-only
---

**Deprecated forwarding alias.** Forward to the canonical read-only
`$change-verdict` Skill with the fixed tests/coverage action:

`$change-verdict --mode tests --coverage $ARGUMENTS`

Preserve `$ARGUMENTS` unchanged after the fixed flags. Propagate the target
status and report its PASS/FAIL/verdict evidence (the owner may classify that
as `READY`, `BLOCKED`, or `INCONCLUSIVE`); a missing or invalid target remains
a failure and is not treated as coverage proof.
