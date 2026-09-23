---
description: 'Refactor one bounded Markdown document without losing information; disclose branch-only reference and visualize relationships only when it improves comprehension.'
argument-hint: '<file path>'
allowed-tools: 'Read, Grep, Glob, Edit'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Forward to the canonical [`$doc-refactor` skill](../skills/doc-refactor/SKILL.md)
with `$ARGUMENTS` unchanged. It owns the bounded-file guard, fact/pointer map,
structure edit, and Markdownlint/link validation.

Preserve its `PASS`, `NOT_RUN`, or `BLOCKED` result and the original/simplified
line counts. This command does not add cross-file policy, generated-projection,
or broad-audit procedure.
