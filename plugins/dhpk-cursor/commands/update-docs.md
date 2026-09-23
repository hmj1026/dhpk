---
name: update-docs
description: "Research the current dhpk implementation and update user or agent docs without changing source semantics."
---
Forward to the canonical [`$update-docs` skill](https://github.com/hmj1026/dhpk/blob/main/skills/update-docs/SKILL.md)
with `$ARGUMENTS` unchanged. It owns target discovery, live evidence, SSOT
mapping, documentation-only edits, locale parity, and the handoff report.

Not for: source/test edits, codemap-only refreshes, policy review, or external-library research.

Preserve the skill’s `PASS`, `NOT_RUN`, `BLOCKED`, or `Need Human` state and its
exact next-command recommendation. This command does not duplicate the update
procedure or authorize source, tests, manifests, route rules, or projections.
