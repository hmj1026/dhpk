---
description: 'Short Claude front door for the read-only $pr-summary Skill and its structured gh report.'
argument-hint: '[--author <user>] [--label <label>]'
allowed-tools: 'Bash(git:*), Bash(gh:*), Bash(bash:*), Skill'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# `/dhpk:pr-summary`

Forward `--author` and `--label` arguments unchanged to the canonical
`$pr-summary` Skill. It owns structured `gh` queries, bot filtering, ticket
grouping, `/tmp/pr-summary.md`, and copy instructions. This command never
changes PR state or adds a second query grammar.

Not for: changing PR state, reviewing code, merging, or closing PRs.

Completion: relay the Skill result and preserve its `PASS`, `FAIL`,
`BLOCKED`, `NOT_RUN`, or `UNAVAILABLE` evidence state.
