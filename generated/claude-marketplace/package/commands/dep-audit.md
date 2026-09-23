---
description: 'Short Claude front door for the evidence-only $dep-audit Skill.'
argument-hint: '[--level <severity>] [--fix]'
allowed-tools: 'Bash(yarn audit *), Bash(npm audit *), Bash(pnpm audit *), Bash(npx *), Bash(bash *), Read, Glob, Skill'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# `/dhpk:dep-audit`

Forward `[--level <severity>] [--fix]` unchanged to the canonical `$dep-audit`
Skill. It owns project-script precedence, ecosystem fallback, the explicit
fix boundary, and the separate read-only `$change-verdict --mode security`
review. This command adds no audit or verdict procedure.

Completion: relay the Skill result and preserve its `PASS`, `FAIL`,
`BLOCKED`, `NOT_RUN`, or `UNAVAILABLE` evidence state.
