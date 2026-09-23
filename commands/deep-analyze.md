---
description: 'Deep-dive analysis of an initial proposal — research code implementation, produce an actionable roadmap and alternatives'
argument-hint: '<initial proposal description or file path>'
allowed-tools: 'Read, Grep, Glob, Bash(git:*), Bash(node:*), Write'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Forward to the canonical [`$proposal-analyze` skill](../skills/proposal-analyze/SKILL.md).
Pass the supplied `$ARGUMENTS` unchanged. The skill owns proposal validation,
native repository research, roadmap/alternative analysis, and the final
assumptions, risks, and immediate-actions report.

Not for: applying an approved OpenSpec change or writing OpenSpec artifacts.

This command is analysis-only: it does not create or apply an OpenSpec change.
If the skill cannot read the proposal or repository, preserve its `BLOCKED`
result. Preserve the skill’s output and any unresolved OpenSpec handoff exactly.
