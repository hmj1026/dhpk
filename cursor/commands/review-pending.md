---
name: review-pending
description: "Short Claude front door for the read-only $review-pending Skill and available code-reviewer."
---
# `/dhpk:review-pending`

Forward the optional `--files "<rel-path,...>"` argument unchanged to the
canonical `$review-pending` Skill. It owns scope selection, `code-reviewer`
availability, diff context, and direct report relay. No alternate reviewer or
merge-gate clearance is added here.

Not for: implementing findings, clearing a merge gate, or silently substituting another reviewer.

Completion: relay the Skill result and preserve its `PASS`, `FAIL`,
`BLOCKED`, `NOT_RUN`, or `UNAVAILABLE` evidence state.
