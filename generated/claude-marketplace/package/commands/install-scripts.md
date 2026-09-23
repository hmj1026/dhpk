---
description: 'Deprecated forwarding alias for dhpk script installation.'
argument-hint: '[--source-artifact <dir>] [--dry-run] [--force]'
metadata:
  dhpk-invocation-class: explicit-only
---

**Deprecated forwarding alias.** Forward to the explicit-only,
workspace-write `$harness-setup` Skill with the fixed installation group:

`$harness-setup --install scripts $ARGUMENTS`

Not for: ordinary harness audits, application changes, or silent credential/configuration changes; new callers use `$harness-setup --install scripts` directly.

Preserve `$ARGUMENTS` unchanged, including `--source-artifact`, dry-run, or force options. Propagate
the target status and report its PASS/FAIL/verdict evidence with host,
preserved-file, receipt, and `PASS`, `BLOCKED`, `UNAVAILABLE`,
`NOT_CONFIGURED`, or `NOT_RUN` state.
