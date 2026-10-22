---
description: 'Read-only workflow guidance and bounded routing. Use when work needs a route, policy lookup, next action, closeout gate, or Codex usage help. Not for implementation, review, code tracing, or skill authoring. Output: one typed report with evidence and a clear handoff.'
argument-hint: '<help|route|rules|next|close> [--go] [<query>]'
allowed-tools: 'Read, Grep, Glob, Skill, Agent'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Load the canonical `$flow-guide` Skill from [SKILL.md](../skills/flow-guide/SKILL.md) and follow it with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
