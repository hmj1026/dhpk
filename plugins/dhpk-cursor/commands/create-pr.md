---
name: create-pr
description: "Short Claude front door for the explicit-only $create-pr Skill; dry-run by default."
---
# `/dhpk:create-pr`

Forward all supplied arguments unchanged to the canonical `$create-pr` Skill.
It owns ticket extraction, pre-flight checks, title/body generation, the
dry-run default, the explicit `--execute` confirmation, and the PR URL
evidence. This command adds no second grammar or push authority.

Not for: committing, pushing, merging, releasing, or editing an existing PR.

Completion: relay the Skill result and preserve its `PASS`, `FAIL`,
`BLOCKED`, `NOT_RUN`, or `UNAVAILABLE` evidence state.
