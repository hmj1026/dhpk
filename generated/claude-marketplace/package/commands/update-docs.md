---
description: 'Research the current dhpk implementation and update user or agent docs without changing source semantics.'
argument-hint: '<docs-path | workflow-keyword>'
allowed-tools: 'Read, Write, Edit, Grep, Glob, Bash(bash:*), Bash(cx:*), Bash(git:*), Bash(ls:*), Bash(node:*)'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Forward to the canonical [`$update-docs` skill](../skills/update-docs/SKILL.md)
with `$ARGUMENTS` unchanged. It owns target discovery, live evidence, SSOT
mapping, documentation-only edits, locale parity, and the handoff report.

Not for: source/test edits, codemap-only refreshes, policy review, or external-library research.

Preserve the skill’s `PASS`, `NOT_RUN`, `BLOCKED`, or `Need Human` state and its
exact next-command recommendation. This command does not duplicate the update
procedure or authorize source, tests, manifests, route rules, or projections.
