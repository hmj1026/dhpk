---
description: 'Short Claude front door for the deterministic $harness-audit Skill.'
argument-hint: '[scope] [--format text|json] [--root <path>]'
allowed-tools: 'Read, Grep, Glob, Bash, Skill'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# `/dhpk:harness-audit`

Forward `[scope] [--format text|json] [--root <path>]` unchanged to the
canonical `$harness-audit` Skill. It owns the package-local deterministic
engine, rubric, scorecard, exact paths, and JSON/text output. This command
adds no scoring dimensions or governance mutation.

Not for: changing harness files, inventing scoring dimensions, or replacing harness governance.

Completion: relay the Skill result and preserve its `PASS`, `FAIL`,
`BLOCKED`, `NOT_RUN`, or `UNAVAILABLE` evidence state.
