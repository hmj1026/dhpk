---
name: deep-analyze
description: "Deep-dive analysis of an initial proposal — research code implementation, produce an actionable roadmap and alternatives"
---
Forward to the canonical [`$proposal-analyze` skill](https://github.com/hmj1026/dhpk/blob/main/skills/proposal-analyze/SKILL.md).
Pass the supplied `$ARGUMENTS` unchanged. The skill owns proposal validation,
native repository research, roadmap/alternative analysis, and the final
assumptions, risks, and immediate-actions report.

This command is analysis-only: it does not create or apply an OpenSpec change.
If the skill cannot read the proposal or repository, preserve its `BLOCKED`
result. Preserve the skill’s output and any unresolved OpenSpec handoff exactly.
