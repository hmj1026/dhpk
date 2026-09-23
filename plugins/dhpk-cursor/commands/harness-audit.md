---
name: harness-audit
description: "Short Claude front door for the deterministic $harness-audit Skill."
---
# `/dhpk:harness-audit`

Forward `[scope] [--format text|json] [--root <path>]` unchanged to the
canonical `$harness-audit` Skill. It owns the package-local deterministic
engine, rubric, scorecard, exact paths, and JSON/text output. This command
adds no scoring dimensions or governance mutation.

Completion: relay the Skill result and preserve its `PASS`, `FAIL`,
`BLOCKED`, `NOT_RUN`, or `UNAVAILABLE` evidence state.
