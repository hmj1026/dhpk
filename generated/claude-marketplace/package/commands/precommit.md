---
description: 'Short Claude front door for the deterministic $precommit Skill.'
argument-hint: '[--fast]'
allowed-tools: 'Bash(node:*), Bash(git:*), Read, Skill'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# `/dhpk:precommit`

Forward `[--fast]` unchanged to the canonical `$precommit` Skill. It owns
package-local runner resolution, mode selection, stage ordering, graceful
skips, changed-file reporting, and the terminal verdict; this front door does
not recreate runner logic.

Not for: ad hoc replacement checks, dependency audits, or read-only verification (use `/dhpk:verify`).

Completion: relay the Skill result and preserve its `PASS`, `FAIL`,
`BLOCKED`, `NOT_RUN`, or `UNAVAILABLE` evidence state.
