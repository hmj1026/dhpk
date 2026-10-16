---
description: 'Use when converting one readable technical specification into a PM or CTO executive brief. Not for editing the source specification or preserving implementation detail. Output: a saved executive-summary path and retained unresolved decisions.'
argument-hint: '<tech spec path> [--output <output path>]'
allowed-tools: 'Read, Grep, Glob, Write'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Load the canonical `$project-brief` Skill from [SKILL.md](../skills/project-brief/SKILL.md) and follow it with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
