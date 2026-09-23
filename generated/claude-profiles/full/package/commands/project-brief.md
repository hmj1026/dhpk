---
description: 'Convert a technical spec into a PM/CTO-readable executive summary. Simplify technical details, focus on business value.'
argument-hint: '<tech spec path> [--output <output path>]'
allowed-tools: 'Read, Grep, Glob, Write'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Forward to the canonical [`$project-brief` skill](../skills/project-brief/SKILL.md).
Pass the supplied `$ARGUMENTS` unchanged, including an optional `--output
<path>`. The skill reads one source specification, writes the executive-summary
shape, and reports the saved path plus retained unresolved decisions.

The source remains read-only. Preserve the skill’s `BLOCKED` result when the
source or output is unavailable; do not inline a second conversion procedure.
