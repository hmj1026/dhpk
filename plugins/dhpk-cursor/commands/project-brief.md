---
name: project-brief
description: "Convert a technical spec into a PM/CTO-readable executive summary. Simplify technical details, focus on business value."
---
Forward to the canonical [`$project-brief` skill](https://github.com/hmj1026/dhpk/blob/main/skills/project-brief/SKILL.md).
Pass the supplied `$ARGUMENTS` unchanged, including an optional `--output
<path>`. The skill reads one source specification, writes the executive-summary
shape, and reports the saved path plus retained unresolved decisions.

The source remains read-only. Preserve the skill’s `BLOCKED` result when the
source or output is unavailable; do not inline a second conversion procedure.
