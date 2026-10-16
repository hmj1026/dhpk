---
description: 'Maintain documentation through stale-doc refresh, architecture codemap generation, or a bounded Markdown refactor. Selects update, codemap, or refactor while preserving each output and evidence contract. Not for application source, tests, manifests, route tables, generated projections, or broad policy review.'
argument-hint: '<docs-path | workflow-keyword>'
allowed-tools: 'Read, Write, Edit, Grep, Glob, Bash(bash:*), Bash(cx:*), Bash(git:*), Bash(ls:*), Bash(node:*)'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Load the canonical `$doc-maintain` Skill from [SKILL.md](../skills/doc-maintain/SKILL.md) and follow it with `update $ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
